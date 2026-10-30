# UsmanAI — UPSS Study Assistant

A responsive school study-assistant app for desktop and mobile, branded around Usman Public School System (UPSS). It is an **independent starter project**, not an official UPSS product and not connected to the school's student login, marks, fee, attendance, or other private records.

The app uses the school's public website as its initial reference for school-related answers. The published site describes the school's vision as nurturing generations to serve as leaders of the Ummah, its mission as developing future leaders guided by Islamic teachings, and its history as beginning with the first campus in 1989. For current or campus-specific information, the app points students to [usman.edu.pk](https://usman.edu.pk/).

## Included features

- Responsive desktop and phone layout, with a mobile sidebar drawer.
- UPSS-inspired crest, school-blue styling, light/dark appearance, and an installable PWA shell.
- New chats, recent chats, chat search, rename/delete actions, and clear-history option.
- Guest mode saves conversation history in the current browser/device.
- Functional account creation, sign-in/sign-out, case-insensitive email login, password hashing, profile/class/campus settings, and saved preferences.
- Session signing key is generated once in `instance/.session_secret` when `SECRET_KEY` is blank, so signing in remains stable across normal app restarts.
- Signed-in chats saved in a local SQLite database. Guest chats can be imported when creating/signing into an account.
- Export the current conversation to a `.txt` file; copy assistant responses.
- Demo tutor works without an AI key (limited built-in answers and arithmetic help).
- Optional OpenAI-compatible chat-completions endpoint for full AI answers. API keys stay on the backend and are not sent to the browser.
- Basic offline app-shell caching after the app has been loaded once. Sending questions still needs the server and, for full AI, internet access.

## Run on Windows

1. Install Python 3.10 or newer from [python.org](https://www.python.org/downloads/). During setup, enable **Add Python to PATH**.
2. Extract this folder somewhere convenient.
3. Double-click `run_windows.bat`. It creates a virtual environment, installs the requirements, makes `.env` from `.env.example`, and starts the app.
4. Open [http://127.0.0.1:5000](http://127.0.0.1:5000) in Chrome or Edge.
5. Click **Sign in** in the top-right, then choose **Create account** to register with your name, email, and a password of at least 8 characters. After registering, you are signed in automatically. Next time, choose **Sign in** and use the same email/password. Account chats are saved to this project’s SQLite database; guest chats remain in that browser. This login is only for this UsmanAI app and is not your school portal login.

The first run needs internet access to install the Python packages. If Windows Firewall asks about Python, allow local/private-network access only if you understand why you need it.

## Run on macOS or Linux

From a terminal in this folder:

```bash
chmod +x run_mac_linux.sh
./run_mac_linux.sh
```

Then open [http://127.0.0.1:5000](http://127.0.0.1:5000).

## Enable full AI answers

The app deliberately works in **Demo mode** without an AI provider key. Demo mode uses built-in teaching examples and is not a general-purpose language model.

1. Stop the app.
2. Open `.env` in a text editor. It is created for you on first run; otherwise copy `.env.example` to `.env`.
3. Set your own provider credentials, for example:

```dotenv
OPENAI_API_KEY=put-your-key-here
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
```

4. Save the file and restart the app. The badge should change to **AI connected** if a key is configured. The app makes requests from the Python backend, never directly from browser JavaScript.

You need an API account and a model/provider that supports the OpenAI-compatible `/chat/completions` endpoint. API usage may cost money; monitor the provider's billing. Keep `.env` private and never commit it to a public repository. The stored response-language and answer-style preferences are included in the full-AI system prompt.

## Desktop window (optional)

The default desktop experience is the installable browser app. If you prefer a separate native-looking window, install `pywebview` inside the project's virtual environment:

```bash
python -m pip install pywebview
python desktop.py
```

The wrapper opens the same local backend. It is optional; the standard app does not need pywebview.

## Install on a phone

For a phone, deploy the app to a server with **HTTPS** and open the deployed address in Chrome (Android) or Safari (iPhone), then choose **Add to Home Screen / Install App**. A PWA service worker requires a secure context for normal installation. `http://127.0.0.1:5000` is only the computer running the server; it is not a public phone-accessible address. Do not expose the development server publicly as-is.

## Deployment and privacy checklist

Before putting this on the public internet:

- Use HTTPS and set `COOKIE_SECURE=1` in `.env`.
- Replace `SECRET_KEY` with a long random secret.
- Use a production WSGI server and an appropriate hosted database/backup strategy rather than Flask's development server.
- Configure API billing limits, account deletion, privacy notice, retention rules, and rate limiting.
- Review applicable school/guardian approval and data-protection requirements before inviting students to use it. For school-wide deployment, get UPSS authorization first.

This starter app does not verify that a sign-up email belongs to UPSS, does not provide password reset or email verification, and has not been hardened for public multi-user production. Do not enter sensitive personal details, passwords, marks, attendance information, or private student records into chat prompts.

## Project structure

```text
UsmanAI/
├── app.py                  # Flask API, authentication, SQLite storage, AI adapter
├── desktop.py              # Optional pywebview desktop wrapper
├── requirements.txt
├── .env.example
├── run_windows.bat
├── run_mac_linux.sh
├── instance/               # SQLite database is created here at runtime
└── static/
    ├── index.html
    ├── styles.css
    ├── app.js
    ├── manifest.json
    ├── sw.js
    └── assets/upss-logo.svg # Clearly marked placeholder; replace with the official UPSS logo
```

## Notes

- The app is intentionally separate from the school's official login and backend systems.
- The local crest is a lightweight UPSS-inspired vector recreation, so the interface stays branded and has a local fallback. The official school site is linked in the sidebar.
- Guest chats are stored in local browser storage and can be lost if browser/site data is cleared. Signed-in chats are stored in `instance/usman_ai.sqlite3`; back up that file if you need to preserve local app data.


### Replace the school logo
The app currently uses a clearly marked **OFFICIAL LOGO PLACEHOLDER** because the correct UPSS logo was not provided. Replace `static/assets/upss-logo.svg` and the `static/assets/upss-icon-180.png`, `upss-icon-192.png`, and `upss-icon-512.png` files with the official school logo/icon files. Keep the filenames the same so the app continues to display them.
