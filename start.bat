@echo off
ECHO Activating Python virtual environment...
CALL .\.venv\Scripts\activate.bat

ECHO Starting Node.js server...
ECHO Press Ctrl+C to stop the server.
node .\server.js
