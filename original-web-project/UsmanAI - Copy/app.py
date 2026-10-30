
from __future__ import annotations

import ast
import json
import os
import re
import secrets
import sqlite3
from datetime import datetime, timezone
from functools import wraps
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv
from flask import Flask, jsonify, request, session, send_from_directory
from werkzeug.security import check_password_hash, generate_password_hash
from supabase import create_client

ROOT = Path(__file__).resolve().parent

load_dotenv(ROOT / ".env")

SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip()
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "").strip()

supabase = (
    create_client(SUPABASE_URL, SUPABASE_KEY)
    if SUPABASE_URL and SUPABASE_KEY
    else None
)


ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")
INSTANCE = ROOT / "instance"
INSTANCE.mkdir(exist_ok=True)
DB_PATH = Path(os.getenv("DATABASE_PATH", str(INSTANCE / "usman_ai.sqlite3")))
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

# Keep login sessions valid across server restarts even when the user leaves
# SECRET_KEY blank in .env. An explicitly configured key always takes priority.
def load_or_create_secret_key() -> str:
    configured = os.getenv("SECRET_KEY", "").strip()
    if configured:
        return configured
    key_file = INSTANCE / ".session_secret"
    try:
        existing = key_file.read_text(encoding="utf-8").strip()
        if len(existing) >= 32:
            return existing
    except OSError:
        pass
    generated = secrets.token_hex(32)
    try:
        key_file.write_text(generated, encoding="utf-8")
    except OSError:
        # The app can still run, but sessions will not survive restarts if the
        # instance directory is not writable.
        pass
    return generated

app = Flask(__name__, static_folder="static", static_url_path="/static")
app.config.update(
    SECRET_KEY=load_or_create_secret_key(),
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.getenv("COOKIE_SECURE", "0") == "1",
    MAX_CONTENT_LENGTH=2 * 1024 * 1024,
)

@app.get("/api/supabase-status")
def supabase_status():
    if supabase is None:
        return jsonify({
            "connected": False,
            "message": "Supabase credentials are missing."
        }), 503

    try:
        supabase.table("profiles").select("id").limit(1).execute()

        return jsonify({
            "connected": True,
            "message": "Supabase database request successful."
        })
    except Exception:
        app.logger.exception("Supabase connection test failed")
        return jsonify({
            "connected": False,
            "message": "Database request failed. Check server logs."
        }), 503



SCHOOL_CONTEXT = """You are UsmanAI, a helpful study companion made for students of Usman Public School System (UPSS), Karachi, Pakistan. You are an independent student helper, not an official school representative and not connected to private school systems.

Public information from the school's website:
- The school's vision is to nurture generations to serve as leaders of the Ummah.
- Its mission is to motivate students to become future leaders who can guide the Muslim Ummah and lead the contemporary world in accordance with Islamic teachings.
- The system says its first campus was established in 1989 and emphasizes Islamic moral values, ethics, and academic standards.
- The school highlights co-curricular activities such as students' week, excursions, book fairs, writing competitions, spelling bees, language fairs, science fairs, and debates.
- Its website provides areas for newcomer test syllabi, book lists, and other school information.
- The published elementary curriculum lists Quran, Islamiat, English, Urdu, Arabic, Mathematics, Science, Computer Studies, Social Studies, Arts, and Physical Education; the exact subjects vary by level.
- The published school ethos/value page names Taqwa, following Prophet Muhammad ﷺ as a role model, enjoining good, research and exploration, service of mankind, and the ideology of Pakistan.
- Campus 9 public listing: Plot ST-5, Block 5, Federal B Area, Karachi; phone 021-33401217; https://usman.edu.pk/campus/9
- Relevant public pages: https://usman.edu.pk/ ; https://usman.edu.pk/academics ; https://usman.edu.pk/about/ethos_value ; https://usman.edu.pk/campus/9

Help with homework by explaining concepts step by step. Prefer age-appropriate, clear explanations and examples. Do not invent campus-specific policies, exam dates, fees, teacher details, student records, or admissions decisions. For changing or official information, direct the student to the school website or their campus. Do not claim to have browsed the live website unless live retrieval is actually available. Ask which class/grade when that would materially improve the explanation. Be encouraging, concise, and honest about uncertainty."""


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    with db() as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            grade TEXT NOT NULL DEFAULT '',
            campus TEXT NOT NULL DEFAULT '',
            preferences TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS chats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            title TEXT NOT NULL DEFAULT 'New chat',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
            role TEXT NOT NULL CHECK(role IN ('user','assistant')),
            content TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_chats_user_updated ON chats(user_id, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id, id);
        """)


init_db()


def current_user() -> sqlite3.Row | None:
    uid = session.get("user_id")
    if not uid:
        return None
    with db() as conn:
        return conn.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()


def user_json(user: sqlite3.Row) -> dict[str, Any]:
    try:
        prefs = json.loads(user["preferences"] or "{}")
    except json.JSONDecodeError:
        prefs = {}
    return {
        "id": user["id"], "name": user["name"], "email": user["email"],
        "grade": user["grade"], "campus": user["campus"], "preferences": prefs,
        "created_at": user["created_at"],
    }


def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not current_user():
            return jsonify({"error": "Please sign in to use this account feature."}), 401
        return fn(*args, **kwargs)
    return wrapper


def validate_text(value: Any, field: str, max_len: int = 6000) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{field} must be text.")
    value = value.strip()
    if not value:
        raise ValueError(f"{field} cannot be empty.")
    if len(value) > max_len:
        raise ValueError(f"{field} is too long (maximum {max_len} characters).")
    return value


# A deliberately small arithmetic evaluator for offline/demo mode. It accepts only arithmetic AST nodes.
def safe_math(expression: str) -> str | None:
    expr = expression.strip().replace("×", "*").replace("÷", "/").replace("−", "-")
    if not re.fullmatch(r"[\d\s+\-*/().%^]+", expr) or not re.search(r"\d", expr):
        return None
    expr = expr.replace("^", "**")
    try:
        tree = ast.parse(expr, mode="eval")
        allowed = (ast.Expression, ast.BinOp, ast.UnaryOp, ast.Add, ast.Sub, ast.Mult, ast.Div,
                   ast.FloorDiv, ast.Mod, ast.Pow, ast.UAdd, ast.USub, ast.Constant, ast.Load)
        if any(not isinstance(node, allowed) for node in ast.walk(tree)):
            return None
        for node in ast.walk(tree):
            if isinstance(node, ast.Constant) and (not isinstance(node.value, (int, float)) or abs(node.value) > 10**12):
                return None
            if isinstance(node, ast.Pow) and isinstance(node.parent if hasattr(node, "parent") else None, ast.AST):
                return None
        # Cap exponent sizes and result size before evaluation.
        for node in ast.walk(tree):
            if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Pow):
                if not isinstance(node.right, ast.Constant) or not isinstance(node.right.value, (int, float)) or abs(node.right.value) > 8:
                    return None
        result = eval(compile(tree, "<math>", "eval"), {"__builtins__": {}}, {})
        if isinstance(result, (int, float)) and abs(result) < 10**18 and result == result:
            formatted = str(int(result)) if isinstance(result, float) and result.is_integer() else str(round(result, 8) if isinstance(result, float) else result)
            return f"Let's solve it step by step.\n\n**Expression:** `{expression.strip()}`\n\nApplying the order of operations gives **{formatted}**.\n\nCheck the expression carefully, especially brackets and division."
    except Exception:
        return None
    return None


def offline_reply(messages: list[dict[str, str]], profile: dict[str, Any] | None = None) -> str:
    last = next((m.get("content", "") for m in reversed(messages) if m.get("role") == "user"), "").strip()
    q = last.lower()
    name = (profile or {}).get("name") or "there"
    grade = (profile or {}).get("grade") or "your class"
    if not last:
        return "Ask me a question about your schoolwork, a subject, or school information."
    greeting = re.fullmatch(r"(hi|hello|hey|salam|assalamualaikum|aoa|good morning|good afternoon)[!. ]*", q)
    if greeting:
        return f"Wa alaikum assalam, {name}! 👋\n\nI'm UsmanAI, your study companion for Usman Public School System. I can help explain lessons, practise questions, plan revision, and point you to public school information. What are we studying today?"
    math = safe_math(last.strip().rstrip("?="))
    if math and len(last) < 100:
        return math
    # Exact, verified public campus facts should be answered before broad school-info fallbacks.
    campus_location_intent = (
        ("campus 9" in q or "campus nine" in q)
        and any(k in q for k in ["where", "located", "location", "address", "phone", "contact", "number", "directions"])
    )
    if campus_location_intent:
        return ("**Usman Public School System — Campus 9**\n\n"
                "📍 **Address:** Plot ST-5, Block 5, Federal B Area, Karachi.\n\n"
                "☎️ **Phone:** 021-33401217\n\n"
                "Official source: [UPSS Campus 9 page](https://usman.edu.pk/campus/9).\n\n"
                "This is public information from the school's website; call the campus to confirm directions or current details.")
    if any(k in q for k in ["syllabus", "book list", "booklist", "test syllabus", "books for class"]):
        return ("The UPSS website has public sections for **Test Syllabus** and **Book List**. Open the [official UPSS website](https://usman.edu.pk/) and choose the relevant section.\n\n"
                "Check the campus and academic year before relying on a list, because the correct material can vary. I don't have access to private student or campus records.")
    if any(k in q for k in ["what subjects", "subjects offered", "subjects in school", "curriculum", "which subjects"]):
        return ("## Subjects listed by UPSS\n\n"
                "The school's published elementary curriculum includes **Quran, Islamiat, English, Urdu, Arabic, Mathematics, Science, Computer Studies, Social Studies, Arts, and Physical Education**. The exact subjects differ by grade/level.\n\n"
                "See the [official Academics page](https://usman.edu.pk/academics) for more context, and confirm your own class's subject list with your campus.")
    if any(k in q for k in ["school values", "core values", "ethos", "taqwa", "values of upss"]):
        return ("## UPSS ethos and values\n\nThe school's public ethos/value page names these values: **Taqwa**, following Prophet Muhammad ﷺ as a role model, enjoining good, research and exploration, service of mankind, and the ideology of Pakistan.\n\nRead the [school's ethos and values page](https://usman.edu.pk/about/ethos_value) for the published descriptions.")
    if any(k in q for k in ["usman public", "upss", "school vision", "school mission", "about the school", "school history", "usman.edu.pk", "school website"]):
        return ("## Usman Public School System (UPSS)\n\n"
                "The school's published vision is **“Nurturing generations to serve the role as leaders of Ummah.”** Its mission emphasizes helping students become future leaders guided by Islamic teachings.\n\n"
                "The school website says its first campus was established in **1989** and highlights academic standards, Islamic moral values, and activities such as book fairs, spelling bees, science fairs, writing competitions, and debates.\n\n"
                "For current campus-specific details, admissions, syllabi, or book lists, check the [official website](https://usman.edu.pk/). I don't have access to private school records.")
    concepts = [
        (["photosynthesis"], "**Photosynthesis** is the process by which green plants use sunlight, water, and carbon dioxide to make glucose (food) and release oxygen.\n\n**In simple steps:**\n1. Roots absorb water.\n2. Leaves take in carbon dioxide.\n3. Chlorophyll captures sunlight.\n4. The plant makes glucose and releases oxygen.\n\n**Remember:** sunlight + water + carbon dioxide → glucose + oxygen (with chlorophyll and light)."),
        (["force", "newton's law", "newtons law"], "A **force** is a push or pull that can change an object's motion or shape. Force is measured in **newtons (N)**.\n\nNewton's second law is **F = m × a**: force equals mass multiplied by acceleration. For example, a 2 kg object accelerating at 3 m/s² needs 6 N of net force."),
        (["fraction", "fractions"], "A **fraction** represents part of a whole. In 3/4, the top number (3) is the numerator and the bottom number (4) is the denominator.\n\nTo add fractions with the same denominator, add the numerators: 1/4 + 2/4 = 3/4. For different denominators, first find a common denominator."),
        (["noun", "pronoun", "verb", "adjective", "adverb"], "In English grammar:\n- **Noun:** names a person, place, thing, or idea (teacher, Karachi, book).\n- **Pronoun:** replaces a noun (he, she, they).\n- **Verb:** shows an action or state (read, write, is).\n- **Adjective:** describes a noun (blue, clever).\n- **Adverb:** describes a verb, adjective, or another adverb (quickly, very).\n\nTell me which one your lesson is about and I'll give you more examples."),
        (["water cycle", "evaporation", "condensation"], "The **water cycle** is the continuous movement of water between Earth's surface and the atmosphere.\n\n1. **Evaporation:** the Sun heats water and it becomes vapour.\n2. **Condensation:** vapour cools and forms clouds.\n3. **Precipitation:** water falls as rain, snow, or hail.\n4. **Collection:** water gathers in rivers, lakes, and oceans, and the cycle repeats."),
    ]
    for keys, answer in concepts:
        if any(k in q for k in keys):
            return answer + f"\n\nI can adapt this explanation for {grade.lower()} if you tell me your exact topic or textbook question."
    if any(k in q for k in ["study plan", "revision", "exam", "memorize", "memorise", "timetable"]):
        return ("## A simple study plan\n\n1. **Read** one small heading and make sure you understand it.\n2. **Close the book** and explain the idea out loud in your own words.\n3. **Write from memory**, then compare with the textbook and fix missing points.\n4. **Test yourself** with 3–5 questions.\n5. **Review again tomorrow** for better retention.\n\nTell me your subjects, exam date, and how much time you have each day, and I'll make a more specific plan.")
    if any(k in q for k in ["who are you", "what can you do", "help me", "what do you do"]):
        return ("I'm **UsmanAI**, an independent AI study-assistant starter for UPSS students. I can explain concepts, walk through maths, create practice quizzes, help plan revision, and summarize publicly available school information.\n\nFor more flexible, open-ended answers, the project owner can add an AI API key in the `.env` file. Without one, this app uses a limited built-in demo tutor.")
    if any(k in q for k in ["quiz", "test me", "practice questions", "mcq"]):
        topic = last.replace("quiz me on", "").replace("make a quiz about", "").strip(" .?!")
        return (f"Let's practise **{topic or 'your topic'}**. Answer these without checking your notes:\n\n"
                "1. What is the main definition or idea?\n2. Can you list two important facts?\n3. Give one real-life example.\n4. What is a common mistake students make about this topic?\n5. Explain the topic in two sentences.\n\nSend me your answers and I'll help review them.")
    return ("I can help you work through that. I’m currently running in **demo mode**, so my built-in responses are limited; adding an AI API key enables full AI answers.\n\n"
            "To get a useful answer right now, try sending the exact textbook question and subject, or ask me to **explain**, **summarize**, **make a quiz**, or **create a revision plan**.\n\n"
            "For official school information, use [usman.edu.pk](https://usman.edu.pk/).")


def ai_reply(messages: list[dict[str, str]], profile: dict[str, Any] | None = None) -> tuple[str, str]:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        return offline_reply(messages, profile), "demo"
    base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
    model = os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip() or "gpt-4o-mini"
    profile = profile or {}
    preferences = profile.get("preferences") if isinstance(profile.get("preferences"), dict) else {}
    language = preferences.get("language", "English")
    response_style = preferences.get("responseStyle", "Step-by-step")
    preference_instructions = (
        f"\nStudent profile (optional): {json.dumps({'grade': profile.get('grade', ''), 'campus': profile.get('campus', '')})}."
        f"\nPreferred response language: {language}. Follow this language preference unless the student requests another language."
        f"\nPreferred answer style: {response_style}. Follow this style where suitable for the question."
        "\nAnswer the user's exact question first. For location/address questions, give the specific requested address directly; do not substitute a general school history or overview. If relevant public school facts are included in the system context, use them. If you do not know an answer, say so clearly rather than changing the subject."
    )
    safe_messages = [{"role": "system", "content": SCHOOL_CONTEXT + preference_instructions}]
    for item in messages[-16:]:
        if isinstance(item, dict) and item.get("role") in ("user", "assistant") and isinstance(item.get("content"), str):
            safe_messages.append({"role": item["role"], "content": item["content"][:6000]})
    try:
        response = requests.post(
            f"{base_url}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={"model": model, "messages": safe_messages, "temperature": 0.65},
            timeout=(8, 50),
        )
        response.raise_for_status()
        data = response.json()
        answer = data["choices"][0]["message"]["content"]
        if not isinstance(answer, str) or not answer.strip():
            raise ValueError("The AI provider returned an empty answer.")
        return answer.strip(), "ai"
    except Exception as exc:
        app.logger.warning("AI provider failed; using demo tutor instead: %s", type(exc).__name__)
        fallback = offline_reply(messages, profile)
        return fallback + "\n\n*Note: the AI provider could not be reached, so I used demo mode for this reply.*", "demo"


@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.get("/manifest.json")
def manifest():
    return send_from_directory(app.static_folder, "manifest.json")


@app.get("/sw.js")
def service_worker():
    response = send_from_directory(app.static_folder, "sw.js")
    response.headers["Service-Worker-Allowed"] = "/"
    return response


@app.get("/api/status")
def status():
    return jsonify({"ok": True, "ai_configured": bool(os.getenv("OPENAI_API_KEY", "").strip()), "app": "UsmanAI"})


@app.get("/api/me")
def me():
    user = current_user()
    return jsonify({"authenticated": bool(user), "user": user_json(user) if user else None})

@app.post("/api/register")
def register():
    data = request.get_json(silent=True) or {}
    try:
        name = validate_text(data.get("name", ""), "Name", 80)
        email = validate_text(data.get("email", ""), "Email", 254).lower()
        password = validate_text(data.get("password", ""), "Password", 200)
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
            return jsonify({"error": "Enter a valid email address."}), 400
        if len(password) < 8:
            return jsonify({"error": "Use a password with at least 8 characters."}), 400
        grade = str(data.get("grade", "")).strip()[:40]
        campus = str(data.get("campus", "")).strip()[:80]
        with db() as conn:
            cur = conn.execute("INSERT INTO users (name,email,password_hash,grade,campus,preferences,created_at) VALUES (?,?,?,?,?,?,?)",
                               (name, email, generate_password_hash(password), grade, campus, json.dumps({"theme": "light", "language": "English"}), now_iso()))
            user_id = cur.lastrowid
            session.clear()
            session["user_id"] = user_id
            user = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return jsonify({"ok": True, "user": user_json(user)}), 201
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except sqlite3.IntegrityError:
        return jsonify({"error": "An account with that email already exists. Try signing in."}), 409


@app.post("/api/login")
def do_login():
    data = request.get_json(silent=True) or {}
    email = str(data.get("email", "")).strip().lower()
    password = data.get("password", "")
    if not isinstance(password, str) or not email:
        return jsonify({"error": "Enter your email and password."}), 400
    with db() as conn:
        user = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if not user or not check_password_hash(user["password_hash"], password):
        return jsonify({"error": "Email or password is incorrect."}), 401
    session.clear()
    session["user_id"] = user["id"]
    return jsonify({"ok": True, "user": user_json(user)})


@app.post("/api/logout")
def logout():
    session.clear()
    return jsonify({"ok": True})


@app.patch("/api/profile")
@login_required
def update_profile():
    data = request.get_json(silent=True) or {}
    user = current_user()
    name = str(data.get("name", user["name"])).strip()[:80] or user["name"]
    grade = str(data.get("grade", user["grade"])).strip()[:40]
    campus = str(data.get("campus", user["campus"])).strip()[:80]
    prefs = json.loads(user["preferences"] or "{}")
    incoming = data.get("preferences")
    if isinstance(incoming, dict):
        allowed_preferences = {
            "theme": {"light", "dark"},
            "language": {"English", "Roman Urdu", "Urdu"},
            "responseStyle": {"Concise", "Step-by-step", "Detailed"},
        }
        for key, allowed_values in allowed_preferences.items():
            value = incoming.get(key)
            if isinstance(value, str) and value in allowed_values:
                prefs[key] = value
    with db() as conn:
        conn.execute("UPDATE users SET name=?, grade=?, campus=?, preferences=? WHERE id=?",
                     (name, grade, campus, json.dumps(prefs), user["id"]))
        updated = conn.execute("SELECT * FROM users WHERE id=?", (user["id"],)).fetchone()
    return jsonify({"ok": True, "user": user_json(updated)})


def chat_json(row: sqlite3.Row) -> dict[str, Any]:
    return {"id": row["id"], "title": row["title"], "created_at": row["created_at"], "updated_at": row["updated_at"]}


@app.get("/api/chats")
@login_required
def get_chats():
    user = current_user()
    with db() as conn:
        rows = conn.execute("SELECT * FROM chats WHERE user_id=? ORDER BY updated_at DESC LIMIT 200", (user["id"],)).fetchall()
    return jsonify({"chats": [chat_json(r) for r in rows]})


@app.post("/api/chats")
@login_required
def create_chat():
    data = request.get_json(silent=True) or {}
    title = str(data.get("title", "New chat")).strip()[:100] or "New chat"
    user = current_user()
    now = now_iso()
    with db() as conn:
        cur = conn.execute("INSERT INTO chats (user_id,title,created_at,updated_at) VALUES (?,?,?,?)", (user["id"], title, now, now))
        row = conn.execute("SELECT * FROM chats WHERE id=?", (cur.lastrowid,)).fetchone()
    return jsonify({"chat": chat_json(row)}), 201


@app.get("/api/chats/<int:chat_id>")
@login_required
def get_chat(chat_id: int):
    user = current_user()
    with db() as conn:
        chat = conn.execute("SELECT * FROM chats WHERE id=? AND user_id=?", (chat_id, user["id"])).fetchone()
        if not chat:
            return jsonify({"error": "Chat not found."}), 404
        rows = conn.execute("SELECT id,role,content,created_at FROM messages WHERE chat_id=? ORDER BY id", (chat_id,)).fetchall()
    return jsonify({"chat": chat_json(chat), "messages": [dict(r) for r in rows]})


@app.patch("/api/chats/<int:chat_id>")
@login_required
def rename_chat(chat_id: int):
    user = current_user()
    data = request.get_json(silent=True) or {}
    try:
        title = validate_text(data.get("title", ""), "Title", 100)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    with db() as conn:
        cur = conn.execute("UPDATE chats SET title=?, updated_at=? WHERE id=? AND user_id=?", (title, now_iso(), chat_id, user["id"]))
        if not cur.rowcount:
            return jsonify({"error": "Chat not found."}), 404
        row = conn.execute("SELECT * FROM chats WHERE id=?", (chat_id,)).fetchone()
    return jsonify({"ok": True, "chat": chat_json(row)})


@app.delete("/api/chats/<int:chat_id>")
@login_required
def delete_chat(chat_id: int):
    user = current_user()
    with db() as conn:
        cur = conn.execute("DELETE FROM chats WHERE id=? AND user_id=?", (chat_id, user["id"]))
    if not cur.rowcount:
        return jsonify({"error": "Chat not found."}), 404
    return jsonify({"ok": True})


@app.delete("/api/chats")
@login_required
def clear_chats():
    user = current_user()
    with db() as conn:
        conn.execute("DELETE FROM chats WHERE user_id=?", (user["id"],))
    return jsonify({"ok": True})


@app.post("/api/import-chats")
@login_required
def import_chats():
    user = current_user()
    data = request.get_json(silent=True) or {}
    chats = data.get("chats")
    if not isinstance(chats, list):
        return jsonify({"error": "Invalid chat import."}), 400
    imported = 0
    with db() as conn:
        for item in chats[:50]:
            if not isinstance(item, dict):
                continue
            title = str(item.get("title", "Imported chat")).strip()[:100] or "Imported chat"
            created = now_iso()
            cur = conn.execute("INSERT INTO chats (user_id,title,created_at,updated_at) VALUES (?,?,?,?)", (user["id"], title, created, created))
            chat_id = cur.lastrowid
            messages = item.get("messages", [])
            if isinstance(messages, list):
                for msg in messages[-100:]:
                    if isinstance(msg, dict) and msg.get("role") in ("user", "assistant") and isinstance(msg.get("content"), str):
                        content = msg["content"].strip()[:6000]
                        if content:
                            conn.execute("INSERT INTO messages (chat_id,role,content,created_at) VALUES (?,?,?,?)",
                                         (chat_id, msg["role"], content, str(msg.get("created_at") or now_iso())))
            imported += 1
    return jsonify({"ok": True, "imported": imported})


@app.post("/api/ask")
def ask():
    data = request.get_json(silent=True) or {}
    message = data.get("message", "")
    try:
        message = validate_text(message, "Message", 6000)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    history = data.get("messages", [])
    if not isinstance(history, list):
        history = []
    clean = []
    for msg in history[-15:]:
        if isinstance(msg, dict) and msg.get("role") in ("user", "assistant") and isinstance(msg.get("content"), str):
            clean.append({"role": msg["role"], "content": msg["content"][:6000]})
    if not clean or clean[-1].get("content") != message or clean[-1].get("role") != "user":
        clean.append({"role": "user", "content": message})
    user = current_user()
    profile = user_json(user) if user else (data.get("profile") if isinstance(data.get("profile"), dict) else {})
    reply, mode = ai_reply(clean, profile)
    return jsonify({"reply": reply, "mode": mode})


@app.post("/api/chats/<int:chat_id>/messages")
@login_required
def send_message(chat_id: int):
    user = current_user()
    data = request.get_json(silent=True) or {}
    try:
        message = validate_text(data.get("message", ""), "Message", 6000)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    with db() as conn:
        chat = conn.execute("SELECT * FROM chats WHERE id=? AND user_id=?", (chat_id, user["id"])).fetchone()
        if not chat:
            return jsonify({"error": "Chat not found."}), 404
        history_rows = conn.execute("SELECT role,content FROM messages WHERE chat_id=? ORDER BY id DESC LIMIT 15", (chat_id,)).fetchall()
        history = [{"role": r["role"], "content": r["content"]} for r in reversed(history_rows)]
        conn.execute("INSERT INTO messages (chat_id,role,content,created_at) VALUES (?,?,?,?)", (chat_id, "user", message, now_iso()))
        history.append({"role": "user", "content": message})
        title = chat["title"]
        if title == "New chat" and message:
            title = (message[:42] + "…") if len(message) > 42 else message
        conn.execute("UPDATE chats SET title=?, updated_at=? WHERE id=?", (title, now_iso(), chat_id))
    reply, mode = ai_reply(history, user_json(user))
    with db() as conn:
        conn.execute("INSERT INTO messages (chat_id,role,content,created_at) VALUES (?,?,?,?)", (chat_id, "assistant", reply, now_iso()))
        row = conn.execute("SELECT * FROM chats WHERE id=?", (chat_id,)).fetchone()
    return jsonify({"reply": reply, "mode": mode, "chat": chat_json(row)})


@app.errorhandler(413)
def too_large(_error):
    return jsonify({"error": "Request is too large."}), 413


@app.errorhandler(500)
def internal_error(_error):
    app.logger.exception("Unhandled server error")
    return jsonify({"error": "Something went wrong on the server. Check the terminal logs for details."}), 500


if __name__ == "__main__":
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "5000"))
    print(f"\nUsmanAI is starting at http://{host}:{port}")
    print("AI mode:", "API connected" if os.getenv("OPENAI_API_KEY") else "demo tutor (add OPENAI_API_KEY to .env for full AI)")
    app.run(host=host, port=port, debug=False)
