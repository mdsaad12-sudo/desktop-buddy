@echo off
rem Stops Desktop Buddy from starting automatically when you sign in.
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Desktop Buddy.lnk" 2>nul && echo Auto-start disabled. || echo Auto-start was not enabled.
pause
