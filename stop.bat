@echo off
rem Stops Desktop Buddy and brings back your normal wallpaper.
powershell -NoProfile -Command "try { Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8770/quit -ContentType 'application/json' -Body '{}' | Out-Null; 'Desktop Buddy stopped.' } catch { 'Desktop Buddy is not running.' }"
timeout /t 2 >nul
