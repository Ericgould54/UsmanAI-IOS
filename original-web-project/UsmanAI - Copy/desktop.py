"""Optional native desktop window wrapper. Install pywebview separately to use it."""
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
URL = "http://127.0.0.1:5000"


def is_ready():
    try:
        with urllib.request.urlopen(URL + "/api/status", timeout=1) as response:
            return response.status == 200
    except Exception:
        return False


def main():
    try:
        import webview
    except ImportError:
        print("Install the optional desktop wrapper with: pip install pywebview")
        raise SystemExit(1)
    child = None
    if not is_ready():
        child = subprocess.Popen([sys.executable, str(ROOT / "app.py")], cwd=str(ROOT), env=os.environ.copy())
        for _ in range(80):
            if is_ready():
                break
            time.sleep(0.25)
    if not is_ready():
        if child:
            child.terminate()
        raise SystemExit("The local server did not start. Try run_windows.bat first and inspect its errors.")
    try:
        webview.create_window("UsmanAI · UPSS Study Assistant", URL, width=1280, height=840, min_size=(360, 600))
        webview.start()
    finally:
        if child:
            child.terminate()


if __name__ == "__main__":
    main()
