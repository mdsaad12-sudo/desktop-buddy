import ctypes
import json
import math
import os
import queue
import re
import threading
import time
from collections import defaultdict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

import ctypes.wintypes as wt

user32 = ctypes.WinDLL("user32", use_last_error=True)
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

GW_OWNER = 4
GA_ROOT = 2
GWL_EXSTYLE = -20
WS_EX_TOOLWINDOW = 0x00000080
PROCESS_QUERY_LIMITED_INFORMATION = 0x1000

AI_PATTERNS = [
    re.compile(p, re.I)
    for p in [
        r"\bkilo\b",
        r"\bclaude\b",
        r"\bcodex\b",
        r"\bgemini\b",
        r"\bcopilot\b",
        r"\baider\b",
        r"\bopenai\b",
        r"\bollama\b",
        r"opencode",
        r"cursor",
    ]
]

GENERIC_TITLES = {"", "Program Manager", "Settings"}
WALLPAPER_TITLE = "Desktop Buddy Wallpaper"
SKIP_EXE = {
    "applicationframehost.exe",
    "shellexperiencehost.exe",
    "searchapp.exe",
    "startmenuexperiencehost.exe",
    "systemsettings.exe",
    "textinputhost.exe",
}


def get_window_text(hwnd):
    buf = ctypes.create_unicode_buffer(512)
    user32.GetWindowTextW(hwnd, buf, 512)
    return buf.value.strip()


def get_class(hwnd):
    buf = ctypes.create_unicode_buffer(256)
    user32.GetClassNameW(hwnd, buf, 256)
    return buf.value.strip()


def get_pid(hwnd):
    pid = wt.DWORD()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    return pid.value


def get_exe_path(pid):
    if not pid:
        return ""
    h = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not h:
        return ""
    try:
        buf = ctypes.create_unicode_buffer(1024)
        size = wt.DWORD(len(buf))
        if kernel32.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(size)):
            return buf.value
        return ""
    finally:
        kernel32.CloseHandle(h)


_start_cache = {}


def proc_start_time(pid):
    """Unix time the process started (cached per pid)."""
    if pid in _start_cache:
        return _start_cache[pid]
    h = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    val = None
    if h:
        try:
            c, e, k, u = (wt.FILETIME() for _ in range(4))
            if kernel32.GetProcessTimes(h, ctypes.byref(c), ctypes.byref(e), ctypes.byref(k), ctypes.byref(u)):
                ft = (c.dwHighDateTime << 32) | c.dwLowDateTime
                val = (ft - 116444736000000000) / 1e7
        finally:
            kernel32.CloseHandle(h)
    if len(_start_cache) > 2000:
        _start_cache.clear()
    _start_cache[pid] = val
    return val


def get_exe(pid):
    return get_exe_path(pid).rsplit("\\", 1)[-1]


class LASTINPUTINFO(ctypes.Structure):
    _fields_ = [("cbSize", wt.UINT), ("dwTime", wt.DWORD)]


def idle_seconds():
    lii = LASTINPUTINFO()
    lii.cbSize = ctypes.sizeof(LASTINPUTINFO)
    if not user32.GetLastInputInfo(ctypes.byref(lii)):
        return 0.0
    return max(0, (kernel32.GetTickCount() - lii.dwTime) & 0xFFFFFFFF) / 1000.0


def is_visible_candidate(hwnd):
    if not user32.IsWindowVisible(hwnd):
        return False
    if user32.GetWindow(hwnd, GW_OWNER):
        return False
    ex = user32.GetWindowLongW(hwnd, GWL_EXSTYLE)
    if ex & WS_EX_TOOLWINDOW:
        return False
    title = get_window_text(hwnd)
    if title in GENERIC_TITLES:
        return False
    return True


APP_KINDS = [
    ("coding", "blacksmith", {"code.exe", "code - insiders.exe", "cursor.exe", "windsurf.exe", "devenv.exe", "idea64.exe", "pycharm64.exe",
                              "webstorm64.exe", "clion64.exe", "rider64.exe", "goland64.exe", "studio64.exe", "sublime_text.exe",
                              "notepad++.exe", "zed.exe", "unity.exe", "godot.exe"}),
    ("terminal", "wizard", {"windowsterminal.exe", "wt.exe", "cmd.exe", "powershell.exe", "pwsh.exe", "conhost.exe", "mintty.exe",
                            "alacritty.exe", "wezterm-gui.exe", "claude.exe", "chatgpt.exe"}),
    ("browser", "traveler", {"chrome.exe", "msedge.exe", "firefox.exe", "brave.exe", "opera.exe", "opera_gx.exe", "vivaldi.exe", "arc.exe", "zen.exe"}),
    ("music", "bard", {"spotify.exe", "wmplayer.exe", "vlc.exe", "itunes.exe", "applemusic.exe", "music.ui.exe", "mpc-hc64.exe",
                       "potplayermini64.exe", "obs64.exe", "audacity.exe", "fl64.exe", "netflix.exe"}),
    ("chat", "messenger", {"slack.exe", "teams.exe", "ms-teams.exe", "discord.exe", "outlook.exe", "olk.exe", "telegram.exe",
                           "whatsapp.exe", "whatsapp.root.exe", "signal.exe", "thunderbird.exe", "zoom.exe"}),
    ("docs", "scholar", {"winword.exe", "notion.exe", "obsidian.exe", "onenote.exe", "acrord32.exe", "acrobat.exe", "sumatrapdf.exe",
                         "notepad.exe", "logseq.exe", "evernote.exe", "typora.exe"}),
    ("games", "samurai", {"steam.exe", "steamwebhelper.exe", "epicgameslauncher.exe", "riotclientservices.exe", "riot client.exe", "leagueclient.exe", "league of legends.exe", "valorant-win64-shipping.exe",
                          "battle.net.exe", "minecraft.exe", "javaw.exe", "robloxplayerbeta.exe", "valorant.exe", "gog galaxy.exe",
                          "xboxapp.exe", "eadesktop.exe", "upc.exe"}),
    ("design", "artist", {"figma.exe", "photoshop.exe", "illustrator.exe", "afterfx.exe", "adobe premiere pro.exe", "blender.exe",
                          "krita.exe", "gimp-2.10.exe", "gimp-3.0.exe", "aseprite.exe", "canva.exe", "inkscape.exe", "resolve.exe",
                          "clipstudiopaint.exe", "mspaint.exe", "paint.net.exe"}),
    ("office", "merchant", {"excel.exe", "powerpnt.exe", "scalc.exe", "soffice.bin", "et.exe", "wps.exe", "quicken.exe"}),
]
TITLE_HINTS = [  # web apps inside a browser tab
    (re.compile(r"google docs|google keep|notion|obsidian", re.I), "docs", "scholar"),
    (re.compile(r"google sheets|microsoft excel|google slides|powerpoint", re.I), "office", "merchant"),
    (re.compile(r"figma|canva|photopea", re.I), "design", "artist"),
    (re.compile(r"youtube music|spotify|soundcloud", re.I), "music", "bard"),
    (re.compile(r"\bgmail\b|outlook|whatsapp|discord|slack", re.I), "chat", "messenger"),
]


def classify_app(exe, title, path=""):
    e = (exe or "").lower()
    t = (title or "").lower()
    for kind, role, names in APP_KINDS:
        if e in names:
            if kind == "browser":
                for pat, k2, r2 in TITLE_HINTS:
                    if pat.search(t):
                        return k2, r2
            return kind, role
    if "visual studio code" in t:
        return "coding", "blacksmith"
    if "\\steamapps\\common\\" in (path or "").lower() or "\\epic games\\" in (path or "").lower():
        return "games", "samurai"
    if e == "explorer.exe" and title and title != "Program Manager":
        return "files", "scout"
    return "unknown", "villager"


def detect_ai(exe, title):
    hay = f"{exe} {title}"
    for pat in AI_PATTERNS:
        m = pat.search(hay)
        if m:
            return m.group(0).lower()
    return None


state = {"ts": 0, "windows": [], "apps": [], "foreground": None, "error": None}
APP_TRACK = {}
EVENT_CLIENTS = []
_ev_lock = threading.Lock()


def broadcast(event):
    """Push an event (e.g. a desktop click) to every open /events stream."""
    with _ev_lock:
        for q in list(EVENT_CLIENTS):
            q.put(event)
lock = threading.Lock()


def snapshot():
    fg = user32.GetForegroundWindow()
    fg_root = user32.GetAncestor(fg, GA_ROOT) if fg else 0
    items = []

    @ctypes.WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)
    def enum_cb(hwnd, _):
        try:
            if not is_visible_candidate(hwnd):
                return True
            title = get_window_text(hwnd)
            if title.startswith(WALLPAPER_TITLE):
                return True
            pid = get_pid(hwnd)
            path = get_exe_path(pid)
            exe = path.rsplit("\\", 1)[-1]
            if exe.lower() in SKIP_EXE:
                return True
            kind, role = classify_app(exe, title, path)
            ai = detect_ai(exe, title) if kind == "terminal" else None
            items.append(
                {
                    "hwnd": int(hwnd),
                    "pid": pid,
                    "exe": exe,
                    "title": title,
                    "kind": kind,
                    "role": role,
                    "ai_tool": ai,
                    "foreground": int(hwnd) == int(fg) or int(hwnd) == int(fg_root),
                }
            )
        except Exception:
            pass
        return True

    user32.EnumWindows(enum_cb, 0)
    grouped = defaultdict(lambda: {"id": "", "exe": "", "kind": "unknown", "role": "villager", "count": 0, "foreground": False, "ai_tools": set()})  # window titles never leave this function
    for w in items:
        key = f'{w["exe"] or w["kind"]}|{w["role"]}'
        g = grouped[key]
        g["id"] = key
        g["exe"] = w["exe"]
        g["kind"] = w["kind"]
        g["role"] = w["role"]
        g["count"] += 1
        st = None if w["exe"].lower() == "explorer.exe" else proc_start_time(w["pid"])  # explorer runs since boot
        if st and (not g.get("started") or st < g["started"]):
            g["started"] = st
        g["foreground"] = g["foreground"] or w["foreground"]
        if w["ai_tool"]:
            g["ai_tools"].add(w["ai_tool"])
    apps = []
    for g in grouped.values():
        apps.append({**g, "ai_tools": sorted(g["ai_tools"])})
    apps.sort(key=lambda a: (not a["foreground"], -a["count"], a["exe"].lower()))
    idle = idle_seconds()
    away = idle >= float(load_config().get("afk_minutes", 5)) * 60
    now = time.time()
    for a in apps:  # open / focus timings per app (reset when the app closes)
        t = APP_TRACK.setdefault(a["id"], {"opened": min(now, a.pop("started", None) or now), "since": None, "total": 0.0})
        a.pop("started", None)
        if a["foreground"] and not away:
            t["since"] = t["since"] or now
        elif t["since"]:
            t["total"] += now - t["since"]
            t["since"] = None
        a["opened_at"], a["focused_since"], a["focus_total"] = t["opened"], t["since"], round(t["total"])
    for gone in set(APP_TRACK) - {a["id"] for a in apps}:
        del APP_TRACK[gone]
    fg_app = next((a for a in apps if a["foreground"]), None)
    return {
        "ts": int(time.time()),
        "platform": "win32",
        "windows_count": len(items),
        "apps": apps,
        "foreground": fg_app,
        "idle_seconds": round(idle),
        "afk": away,
    }


def poll_loop():
    while True:
        try:
            data = snapshot()
            with lock:
                state.clear()
                state.update(data)
        except Exception as e:
            with lock:
                state["error"] = str(e)
                state["ts"] = int(time.time())
        time.sleep(2)


HOST, PORT = "127.0.0.1", int(os.environ.get("DESKTOP_BUDDY_PORT", "8770"))
WEB_DIR = (Path(__file__).resolve().parent.parent / "web").resolve()
CONFIG_PATH = Path(__file__).resolve().parent / "config.json"
CONFIG_DEFAULTS = {"city": "", "lat": None, "lon": None, "place": "", "afk_minutes": 5}
_cfg_lock = threading.Lock()
quit_event = threading.Event()
MIME = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
        ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".ico": "image/x-icon"}


def load_config():
    with _cfg_lock:
        try:
            data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        except Exception:
            data = {}
    return {**CONFIG_DEFAULTS, **{k: v for k, v in data.items() if k in CONFIG_DEFAULTS}}


def save_config(update):
    cfg = load_config()
    for k, v in update.items():
        if k == "city" and isinstance(v, str):
            cfg[k] = v.strip()[:80]
        elif k == "place" and isinstance(v, str):
            cfg[k] = v.strip()[:120]
        elif k in ("lat", "lon") and v is None:
            cfg[k] = None
        elif k in ("lat", "lon") and isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) \
                and abs(v) <= (90 if k == "lat" else 180):
            cfg[k] = round(float(v), 2)
        elif k == "afk_minutes" and isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v):
            cfg[k] = max(1, min(120, int(v)))
    with _cfg_lock:
        CONFIG_PATH.write_text(json.dumps(cfg, indent=2), encoding="utf-8")
    return cfg


def _reject_constant(name):
    raise ValueError(f"{name} is not allowed")


MAX_EVENT_CLIENTS = 8
OWN_ORIGINS = {f"http://{HOST}:{PORT}", f"http://localhost:{PORT}"}
# The town page only needs scripts/styles from itself, weather from Open-Meteo, and images from itself.
CSP = ("default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; "
       "connect-src 'self' https://api.open-meteo.com https://geocoding-api.open-meteo.com; object-src 'none'; base-uri 'none'; "
       "form-action 'none'")


class Handler(BaseHTTPRequestHandler):
    timeout = 20  # drop idle / half-sent connections instead of holding a thread forever

    def _send(self, code, body, ctype="application/json", shareable=False):
        """No CORS headers, ever: other websites open in your browser must not read your app list or location.
        shareable=True only for /health, so the Lively launcher page (a local file) can see the agent is up."""
        raw = body if isinstance(body, bytes) else body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        if not shareable:
            self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        if ctype.startswith("text/html"):
            self.send_header("Content-Security-Policy", CSP)
        self.end_headers()
        self.wfile.write(raw)

    def _host_ok(self):
        """Blocks DNS-rebinding (a website pointing its own domain at 127.0.0.1)."""
        return (self.headers.get("Host") or "") in (f"{HOST}:{PORT}", f"localhost:{PORT}")

    def _cross_site(self):
        """True when another website (or a local file) triggered this request from your browser."""
        origin = self.headers.get("Origin")
        if origin is not None and origin not in OWN_ORIGINS:
            return True
        return (self.headers.get("Sec-Fetch-Site") or "same-origin") not in ("same-origin", "none")

    def do_GET(self):
        if not self._host_ok():
            return self._send(403, '{"error":"forbidden"}')
        path = urlparse(self.path).path
        if path == "/health":
            return self._send(200, '{"ok":true,"app":"desktop-buddy"}', shareable=True)
        # Opening the page itself is fine from anywhere (e.g. the Lively launcher redirects here): a navigation can't be
        # read back by the site that started it. Everything else (data, scripts, images) must come from our own page.
        if self._cross_site() and not (self.headers.get("Sec-Fetch-Mode") == "navigate" and path not in ("/status", "/config", "/events")):
            return self._send(403, '{"error":"forbidden"}')
        if path == "/status":
            with lock:
                payload = json.dumps(state)
            return self._send(200, payload)
        if path == "/config":
            return self._send(200, json.dumps(load_config()))
        if path == "/events":
            return self._stream()
        if path == "/wallpaper-image":
            return self._wallpaper_image()
        rel = unquote(path).lstrip("/") or "index.html"
        target = (WEB_DIR / rel).resolve()
        if WEB_DIR not in target.parents or not target.is_file() or target.suffix.lower() not in MIME:
            return self._send(404, '{"error":"not found"}')
        self._send(200, target.read_bytes(), MIME[target.suffix.lower()])

    def _stream(self):
        q = queue.Queue()
        with _ev_lock:
            if len(EVENT_CLIENTS) >= MAX_EVENT_CLIENTS:
                return self._send(503, '{"error":"busy"}')
            EVENT_CLIENTS.append(q)
        self.connection.settimeout(None)  # long-lived stream: only the write side matters here
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(b": hello\n\n")
            self.wfile.flush()
            while not quit_event.is_set():
                try:
                    msg = f"data: {json.dumps(q.get(timeout=15))}\n\n"
                except queue.Empty:
                    msg = ": ping\n\n"
                self.wfile.write(msg.encode())
                self.wfile.flush()
        except OSError:
            pass
        finally:
            with _ev_lock:
                if q in EVENT_CLIENTS:
                    EVENT_CLIENTS.remove(q)

    def _wallpaper_image(self):
        """Your normal wallpaper picture: the town fades in on top of it, so startup has no blank frame."""
        try:
            import winreg
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Control Panel\Desktop") as k:
                p = Path(winreg.QueryValueEx(k, "WallPaper")[0])
            mime = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".bmp": "image/bmp", ".webp": "image/webp"}.get(p.suffix.lower())
            if mime and p.is_file() and p.stat().st_size <= 64 * 1024 * 1024:
                return self._send(200, p.read_bytes(), mime)
        except Exception:
            pass
        self._send(404, '{"error":"none"}')

    def do_POST(self):
        # JSON content-type is required (browsers cannot send it cross-origin without a preflight, which we never allow),
        # and requests coming from any other website are refused outright.
        if not self._host_ok() or self._cross_site() or \
                not (self.headers.get("Content-Type") or "").startswith("application/json"):
            return self._send(403, '{"error":"forbidden"}')
        path = urlparse(self.path).path
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if length < 0 or length > 4096:
                return self._send(413, '{"error":"too large"}')
            body = json.loads(self.rfile.read(length) or b"{}", parse_constant=_reject_constant)  # no NaN / Infinity
        except Exception:
            return self._send(400, '{"error":"bad json"}')
        if path == "/config" and isinstance(body, dict):
            return self._send(200, json.dumps(save_config(body)))
        if path == "/quit":
            self._send(200, '{"ok":true}')
            quit_event.set()
            return
        self._send(404, '{"error":"not found"}')

    def do_OPTIONS(self):  # never approve a cross-origin preflight
        self._send(403, '{"error":"forbidden"}')

    def log_message(self, *_):
        return


def start_server():
    """Start the poller + HTTP server in background threads. Returns the server."""
    threading.Thread(target=poll_loop, daemon=True).start()
    class Server(ThreadingHTTPServer):
        allow_reuse_address = False  # on Windows reuse would let two agents share the port
        daemon_threads = True

    srv = Server((HOST, PORT), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


if __name__ == "__main__":
    start_server()
    print(f"Desktop Buddy agent: http://{HOST}:{PORT}/  (status: /status, settings: /settings.html)")
    try:
        while not quit_event.wait(1):
            pass
    except KeyboardInterrupt:
        pass
