@echo off
rem Makes Desktop Buddy start automatically when you sign in.
rem   install_autostart.bat        -> Lively mode (Lively shows the town)
rem   install_autostart.bat edge   -> built-in mode (Edge window behind the desktop icons)
set "BUDDY_DIR=%~dp0"
set "BUDDY_MODE=--lively"
if /I "%~1"=="edge" set "BUDDY_MODE="
powershell -NoProfile -ExecutionPolicy Bypass -Command "$py=(Get-Command pyw.exe -ErrorAction SilentlyContinue).Source; if(-not $py){'Python launcher (pyw.exe) not found. Install Python from python.org with the py launcher option.'; exit 1}; $d=$env:BUDDY_DIR; $s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup')+'\Desktop Buddy.lnk'); $s.TargetPath=$py; $s.Arguments='-3 \"'+$d+'agent\desktop_buddy.py\" '+$env:BUDDY_MODE; $s.WorkingDirectory=$d; $s.Save(); 'Auto-start enabled.'"
pause
