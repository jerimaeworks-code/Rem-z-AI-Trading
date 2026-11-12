@echo off
cd /d "%~dp0.."
start "Remz AI Bridge" /min cmd /c "node localhost_bridge.js"
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:8765/"
