# Changelog

## v1.0.1 (2026-11-06): security fixes (please update)

- **Fixed:** other websites open in your browser could read the local agent's data (your open apps, window titles,
  away status and saved location) because it allowed cross-origin requests. The agent now sends no CORS headers and
  refuses any request that comes from another website.
- Window titles are no longer included in the agent's `/status` data at all (they are only used inside the agent).
- Added security headers (Content-Security-Policy, Cross-Origin-Resource-Policy, nosniff, no-referrer).
- Settings values are validated (no NaN / out-of-range coordinates); oversized or malformed requests are rejected.
- Idle or half-sent connections are dropped after 20 s, and live event streams are capped, so a misbehaving client
  can't tie up the agent.

## v1.0.0 (2026-11-06): first release

### The town
- Hand-drawn pixel-art hometown (640×360 scene, scaled crisply to any screen resolution, 30 fps).
- Buildings: Forge, Shrine Tower, Traveler's Inn, Festival Stage, Post Hall, Storehouse, Library, Dojo, Atelier,
  Market, Tea House, hot spring, homes, a river with a bridge, benches, a well, cherry trees and stone lanterns.
- 12 residents, two town cats (Mochi and Kuro) and flocks of birds that scatter when someone walks by.

### Your PC → the town
- Every open app becomes a resident with a job: Blacksmith (coding), Shrine Wizard (terminal / AI tools),
  Traveler (browser), Bard (music / video), Messenger (chat / mail), Scout (files), Scholar (docs / notes),
  Samurai (games), Artist (design), Merchant (sheets / office), Villager (anything else).
- Web apps inside a browser tab (Gmail, Google Docs, Sheets, Figma, Spotify…) are recognised by window title,
  and AI tools (Claude, Codex, Gemini, Copilot, Ollama…) running in a terminal are shown on the Wizard's card.
- Apps of the same kind share one resident (no duplicate workers).
- The app in focus: its resident works at their building with job animations and effects
  (forge sparks, runes, music notes, flying letters, coins, paint, sword slashes).
- Apps open in the background: residents chat with each other (speech bubbles, gestures), do light chores
  at their building and stroll around. Nobody stands frozen.
- Free residents: fishing, benches, tea, hot spring, the well, watching the Bard, chatting in the plaza, going home.
- Away from the PC (default 5 minutes without input): the whole town falls asleep, on benches when possible.
  Coming back wakes everyone up.
- Click a resident (on an empty part of the desktop) for an info card: app name, in focus now and for how long,
  running time and total focus time. Click a cat to see what it is up to.

### Time and weather
- Day, dusk and night follow your real clock with real sunrise and sunset times; lanterns and windows light up at night.
- Real local weather from Open-Meteo: clear, clouds, rain, thunderstorms, snow and fog, with umbrellas and lightning.
- Fireflies at night, falling cherry petals, chimney smoke.

### Running it
- Two ways to show it as your wallpaper: with **Lively Wallpaper** (recommended) or the **built-in mode**
  (a frameless Edge window attached behind the desktop icons; Windows 10 and Windows 11 including 24H2).
- Pauses automatically while a game or fullscreen app covers the desktop.
- Settings page for your city and the away timer.
- `install_autostart.bat` / `uninstall_autostart.bat` to start it at sign-in.
- Runs locally only (`127.0.0.1`); no extra Python packages needed.
