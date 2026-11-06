@echo off
rem Starts the Desktop Buddy agent for Lively Wallpaper (no console).
rem In Lively, set the wallpaper to the URL  http://127.0.0.1:8770/
start "" pyw -3 "%~dp0agent\desktop_buddy.py" --lively
