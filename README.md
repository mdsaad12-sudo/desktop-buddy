# Desktop Buddy

A live pixel-art hometown on your Windows desktop wallpaper that mirrors what you do on your PC.

![Desktop Buddy town](docs/screenshot.png)

## What it does

Every app you have open becomes a **resident of the town with a job**:

| App type | Examples | Resident | Workplace |
|---|---|---|---|
| Coding | VS Code, Visual Studio, IntelliJ, PyCharm, Cursor | Blacksmith | Forge |
| Terminal / AI tools | Windows Terminal, PowerShell, Command Prompt, Claude, ChatGPT | Shrine Wizard | Shrine Tower |
| Browser | Chrome, Edge, Firefox, Brave, Opera, Vivaldi | Traveler | explores the whole town |
| Music / video | Spotify, VLC, Media Player, OBS | Bard | Festival Stage |
| Chat / mail | Discord, Slack, Teams, WhatsApp, Telegram, Outlook, Zoom | Messenger | Post Hall |
| Files | File Explorer | Scout | Storehouse |
| Docs / notes | Word, Notion, Obsidian, OneNote, Notepad, PDF readers | Scholar | Library |
| Games | Steam, Epic Games, Riot, Battle.net, Minecraft, Roblox | Samurai | Dojo |
| Design / art | Figma, Photoshop, Blender, Krita, GIMP, Paint | Artist | Atelier |
| Sheets / office | Excel, PowerPoint, LibreOffice Calc | Merchant | Market |
| Anything else | | Villager | Plaza |

- The resident of the app **you are using right now** works hard at their workplace (sparks at the forge, magic runes,
  music notes, flying letters…).
- Residents of apps **open in the background** take breaks: they chat with each other, do light chores and stroll around.
- Residents without an app enjoy free time: fishing, sitting on benches, tea, the hot spring, watching the Bard play.
- When you **step away** from the PC, the whole town falls asleep. When you come back, everyone wakes up.
- **Day and night follow your real clock** (with real sunrise and sunset) and the **weather follows your real local weather**
  (rain, snow, storms, fog), once you set your city.
- **Click a resident** on an empty part of the desktop to see which app they stand for, whether it is in focus,
  and how long it has been running. Two town cats and some birds live there too.

## Privacy

Everything runs locally on your PC.

- The agent only listens on `127.0.0.1` (your own computer). Nothing about your apps or activity is sent anywhere.
- It reads the **names of the programs** that have open windows (e.g. `code.exe`), which one is in focus,
  and how long since your last mouse or keyboard input (to know when you are away). It also looks at **window titles**
  locally to recognise web apps in a browser tab (e.g. Gmail, Google Docs) and AI tools in a terminal.
  It does not read window contents, keystrokes or files, and none of this leaves your PC.
- The only internet requests are to [Open-Meteo](https://open-meteo.com/) (free, no account) to look up your city and
  get its weather. Your city is saved only on your PC, in `agent/config.json`.
- Your normal wallpaper image is shown behind the town while it loads (served locally).

## System requirements

- **Windows 10 or Windows 11** (tested on Windows 11 24H2).
- **Python 3.9 or newer** from [python.org](https://www.python.org/downloads/windows/), installed with the
  **"py launcher"** option (it is on by default). No extra Python packages are needed.
- **One of these to show the town on your desktop:**
  - **[Lively Wallpaper](https://www.rocksdanister.com/lively/)** (free, recommended; from the Microsoft Store or GitHub), or
  - **Microsoft Edge** (already part of Windows) for the built-in wallpaper mode.
- About 150–250 MB of RAM while running. The town runs at 30 fps and pauses while a game or fullscreen app covers the desktop.

## Install

1. **Install Python** from [python.org](https://www.python.org/downloads/windows/) (keep "py launcher" ticked).
2. **Download Desktop Buddy:** on this page click **Code → Download ZIP** and extract it somewhere permanent,
   for example your `Documents` folder. (Or `git clone` it.)
3. Pick how to show the town:

### Option A: with Lively Wallpaper (recommended)

1. Install **Lively Wallpaper** from the Microsoft Store.
2. Double-click **`start_lively.bat`** in the Desktop Buddy folder. Nothing visible happens; the agent now runs in the background.
3. Open Lively and **drag `DesktopBuddy_Lively.zip` into the Lively window** (or click **+** and choose that file).
4. Click **Desktop Buddy** in your Lively library to set it as your wallpaper.
5. *(Optional)* In Lively **Settings → Wallpaper**, set wallpaper input to **Mouse** so hovering over residents shows tooltips.

### Option B: built-in mode (no extra app)

Double-click **`start.bat`**. The town appears behind your desktop icons within a few seconds.

### Set your city (for real weather)

While it is running, open **http://127.0.0.1:8770/settings.html** in your browser, type your city and click **Save**.
You can also change how many minutes without input count as "away" (default 5).

### Start automatically when you sign in

- Double-click **`install_autostart.bat`** (Lively mode) or run `install_autostart.bat edge` (built-in mode).
- If you use Lively, also turn on **"Start with Windows"** in Lively's settings.
- To turn auto-start off, double-click **`uninstall_autostart.bat`**.

## Use

| | |
|---|---|
| Start | `start_lively.bat` (Lively) or `start.bat` (built-in) |
| Stop | `stop.bat` (with Lively, also close or change the wallpaper in Lively) |
| Settings | http://127.0.0.1:8770/settings.html |
| Preview in a browser | http://127.0.0.1:8770/ |
| Log file | `agent/desktop_buddy.log` |

## Troubleshooting

- **Lively shows "Waiting for the Desktop Buddy agent…"**: run `start_lively.bat`. The page connects by itself once the agent is up.
- **Nothing happens with `start.bat`**: make sure Python is installed with the py launcher (`py --version` in a terminal),
  then check `agent/desktop_buddy.log`.
- **Port 8770 is already used by another program**: set the environment variable `DESKTOP_BUDDY_PORT` to another port
  (Lively mode then also needs the new port in `lively/index.html`).
- **Weather never changes**: set your city at the settings page.

## How it works

- `agent/server.py`: polls the open windows, classifies each app into a job, detects when you are away, and serves the town
  plus `/status` and `/config` on `127.0.0.1:8770`. Standard library only.
- `agent/desktop_buddy.py`: entry point. Starts the server, forwards desktop clicks to the town, and (built-in mode) opens the town
  in a frameless Edge window attached behind the desktop icons. With `--lively` it leaves displaying the town to Lively.
- `web/town.js`: the town engine (640×360 pixel scene scaled crisply to your screen): residents, jobs, day/night, weather, cats and birds.
- `lively/`: the Lively Wallpaper package (`DesktopBuddy_Lively.zip` is the same folder zipped). It waits for the agent and then opens the town.

See [CHANGELOG.md](CHANGELOG.md) for what's in each version.

## License

[MIT](LICENSE)
