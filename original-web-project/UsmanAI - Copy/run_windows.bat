@echo off
cd /d "%~dp0"
if not exist .venv (
  py -m venv .venv
  if errorlevel 1 goto error
)
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
if errorlevel 1 goto error
pip install -r requirements.txt
if errorlevel 1 goto error
if not exist .env copy .env.example .env
echo.
echo Starting UsmanAI. Keep this terminal window open.
start "" /b cmd /c "ping 127.0.0.1 -n 3 ^>nul ^& start http://127.0.0.1:5000"
python app.py
pause
goto :eof
:error
echo.
echo Setup failed. Check your Python installation and internet connection, then try again.
pause
