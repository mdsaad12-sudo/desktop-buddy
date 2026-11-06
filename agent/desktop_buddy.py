"""
Desktop Buddy: live pixel-town wallpaper.

Starts the activity agent (server.py), opens the town in a frameless Edge app window and
attaches that window to the Windows desktop layer (behind the icons, under the real taskbar).

  start:  pyw agent\\desktop_buddy.py      (or start.bat)
  stop:   stop.bat                          (POST /quit; restores the normal wallpaper)

  --lively  Lively Wallpaper displays the town (set it to the URL http://127.0.0.1:8770/);
            this process then only runs the activity agent + desktop click forwarding.
"""
import ctypes
import ctypes.wintypes as wt
import json
import logging
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import server  # noqa: E402

LOG_PATH = Path(__file__).resolve().parent / "desktop_buddy.log"
logging.basicConfig(filename=LOG_PATH, level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("buddy")

user32 = ctypes.WinDLL("user32", use_last_error=True)
try:
    user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))  # per-monitor v2 → physical pixels
except Exception:
    pass

user32.FindWindowW.restype = wt.HWND
user32.FindWindowExW.restype = wt.HWND
user32.FindWindowExW.argtypes = [wt.HWND, wt.HWND, wt.LPCWSTR, wt.LPCWSTR]
user32.SetParent.restype = wt.HWND
user32.SetParent.argtypes = [wt.HWND, wt.HWND]
user32.GetParent.restype = wt.HWND
user32.GetParent.argtypes = [wt.HWND]
user32.GetForegroundWindow.restype = wt.HWND
user32.SetWindowPos.argtypes = [wt.HWND, wt.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wt.UINT]
user32.IsWindow.argtypes = [wt.HWND]
user32.ShowWindow.argtypes = [wt.HWND, ctypes.c_int]
user32.GetWindowLongW.argtypes = [wt.HWND, ctypes.c_int]
user32.SetWindowLongW.argtypes = [wt.HWND, ctypes.c_int, ctypes.c_long]
user32.SendMessageTimeoutW.argtypes = [wt.HWND, wt.UINT, wt.WPARAM, wt.LPARAM, wt.UINT, wt.UINT, ctypes.POINTER(ctypes.c_size_t)]
user32.GetWindowRect.argtypes = [wt.HWND, ctypes.POINTER(wt.RECT)]
user32.GetClassNameW.argtypes = [wt.HWND, wt.LPWSTR, ctypes.c_int]
user32.GetClientRect.argtypes = [wt.HWND, ctypes.POINTER(wt.RECT)]
user32.ClientToScreen.argtypes = [wt.HWND, ctypes.POINTER(wt.POINT)]
user32.GetAncestor.restype = wt.HWND
user32.GetAncestor.argtypes = [wt.HWND, wt.UINT]

GWL_STYLE, GWL_EXSTYLE = -16, -20
WS_CHILD, WS_VISIBLE, WS_POPUP = 0x40000000, 0x10000000, 0x80000000
WS_CAPTION, WS_THICKFRAME, WS_SYSMENU, WS_MINIMIZEBOX, WS_MAXIMIZEBOX = 0x00C00000, 0x00040000, 0x00080000, 0x00020000, 0x00010000
WS_EX_APPWINDOW, WS_EX_TOOLWINDOW, WS_EX_NOACTIVATE = 0x00040000, 0x00000080, 0x08000000
SWP_NOSIZE, SWP_NOMOVE, SWP_NOZORDER, SWP_NOACTIVATE, SWP_FRAMECHANGED, SWP_SHOWWINDOW = 0x1, 0x2, 0x4, 0x10, 0x20, 0x40
SW_HIDE, SW_SHOWNA = 0, 8
SM_CXSCREEN, SM_CYSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN = 0, 1, 76, 77
SPI_SETDESKWALLPAPER, SPIF_SENDCHANGE = 20, 2
CREATE_NO_WINDOW = 0x08000000

URL = f"http://{server.HOST}:{server.PORT}/"
PROFILE = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "DesktopBuddy" / "edge-profile"


def find_edge():
    for base in (os.environ.get("ProgramFiles(x86)"), os.environ.get("ProgramFiles"), os.environ.get("LOCALAPPDATA")):
        if base:
            p = Path(base) / "Microsoft" / "Edge" / "Application" / "msedge.exe"
            if p.exists():
                return str(p)
    raise FileNotFoundError("Microsoft Edge not found")


def kill_our_edge():
    """Close any Edge processes that use the Desktop Buddy profile (leaves your normal Edge alone)."""
    ps = ("Get-CimInstance Win32_Process -Filter \"name='msedge.exe'\" | "
          "Where-Object { $_.CommandLine -like '*DesktopBuddy*edge-profile*' } | "
          "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }")
    subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps], creationflags=CREATE_NO_WINDOW,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)


def screen_rect():
    w, h = user32.GetSystemMetrics(SM_CXSCREEN), user32.GetSystemMetrics(SM_CYSCREEN)
    vx, vy = user32.GetSystemMetrics(SM_XVIRTUALSCREEN), user32.GetSystemMetrics(SM_YVIRTUALSCREEN)
    return -vx, -vy, w, h  # primary monitor, in the desktop window's client coordinates


def class_name(hwnd):
    buf = ctypes.create_unicode_buffer(256)
    user32.GetClassNameW(hwnd, buf, 256)
    return buf.value


def find_app_window():
    found = []

    @ctypes.WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)
    def cb(h, _):
        if server.get_window_text(h).startswith(server.WALLPAPER_TITLE) and class_name(h) == "Chrome_WidgetWin_1":
            found.append(h)
        return True

    user32.EnumWindows(cb, 0)
    return found[0] if found else None


def desktop_layer():
    """Returns (mode, parent, workerw, defview)."""
    progman = user32.FindWindowW("Progman", None)
    res = ctypes.c_size_t()
    user32.SendMessageTimeoutW(progman, 0x052C, 0xD, 0x1, 0, 1000, ctypes.byref(res))
    user32.SendMessageTimeoutW(progman, 0x052C, 0, 0, 0, 1000, ctypes.byref(res))
    time.sleep(0.3)
    worker = []

    @ctypes.WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)
    def cb(h, _):
        if user32.FindWindowExW(h, None, "SHELLDLL_DefView", None):
            w = user32.FindWindowExW(None, h, "WorkerW", None)
            if w:
                worker.append(w)
        return True

    user32.EnumWindows(cb, 0)
    if worker:  # classic layout (Windows 10 / 11 before 24H2)
        return "classic", worker[0], worker[0], None
    w = user32.FindWindowExW(progman, None, "WorkerW", None)
    dv = user32.FindWindowExW(progman, None, "SHELLDLL_DefView", None)
    if w and dv:  # Windows 11 24H2+ layout: WorkerW + icons both live inside Progman
        return "raised", progman, w, dv
    return None


def place(hwnd, after, x, y, w, h, flags):
    """Position the window so its *client area* (the page) exactly covers x,y,w,h, hiding any leftover frame."""
    user32.SetWindowPos(hwnd, after, x, y, w, h, flags)
    wr, cr, pt = wt.RECT(), wt.RECT(), wt.POINT(0, 0)
    user32.GetWindowRect(hwnd, ctypes.byref(wr))
    user32.GetClientRect(hwnd, ctypes.byref(cr))
    user32.ClientToScreen(hwnd, ctypes.byref(pt))
    left, top = pt.x - wr.left, pt.y - wr.top
    right, bottom = (wr.right - wr.left) - cr.right - left, (wr.bottom - wr.top) - cr.bottom - top
    if left or top or right or bottom:
        user32.SetWindowPos(hwnd, after, x - left, y - top, w + left + right, h + top + bottom, flags)


def attach(hwnd):
    layer = desktop_layer()
    if not layer:
        log.error("desktop layer not found")
        user32.ShowWindow(hwnd, SW_HIDE)  # never leave it floating over your apps
        return None
    mode, parent, workerw, defview = layer
    style = user32.GetWindowLongW(hwnd, GWL_STYLE) & 0xFFFFFFFF
    style &= ~(WS_POPUP | WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX)
    style |= WS_CHILD | WS_VISIBLE
    user32.SetWindowLongW(hwnd, GWL_STYLE, ctypes.c_long(style - (1 << 32) if style >= 1 << 31 else style).value)
    ex = user32.GetWindowLongW(hwnd, GWL_EXSTYLE) & 0xFFFFFFFF
    ex = (ex & ~WS_EX_APPWINDOW) | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE
    user32.SetWindowLongW(hwnd, GWL_EXSTYLE, ctypes.c_long(ex - (1 << 32) if ex >= 1 << 31 else ex).value)
    user32.SetParent(hwnd, parent)
    x, y, w, h = screen_rect()
    if mode == "raised":
        place(hwnd, defview, x, y, w, h, SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_SHOWWINDOW)       # just below the icons
        user32.SetWindowPos(workerw, hwnd, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE)  # static wallpaper below us
    else:
        place(hwnd, None, x, y, w, h, SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_SHOWWINDOW)
    log.info("attached hwnd=%s mode=%s parent=%s size=%sx%s", hwnd, mode, parent, w, h)
    return parent


def foreground_is_fullscreen(own):
    fg = user32.GetForegroundWindow()
    if not fg or fg == own or user32.GetAncestor(fg, 2) in (own, user32.GetParent(own)):
        return False
    if class_name(fg) in ("Progman", "WorkerW", "Shell_TrayWnd") or server.get_window_text(fg).startswith(server.WALLPAPER_TITLE):
        return False
    r = wt.RECT()
    user32.GetWindowRect(fg, ctypes.byref(r))
    w, h = user32.GetSystemMetrics(SM_CXSCREEN), user32.GetSystemMetrics(SM_CYSCREEN)
    return r.left <= 0 and r.top <= 0 and r.right >= w and r.bottom >= h


def refresh_wallpaper():
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Control Panel\Desktop") as k:
            path = winreg.QueryValueEx(k, "WallPaper")[0]
        ctypes.windll.user32.SystemParametersInfoW(SPI_SETDESKWALLPAPER, 0, path, SPIF_SENDCHANGE)
    except Exception as e:
        log.warning("wallpaper refresh failed: %s", e)


class Wallpaper:
    def __init__(self):
        self.edge = find_edge()
        self.hwnd = None
        self.parent = None
        self.size = None
        self.hidden = False

    def launch(self):
        kill_our_edge()
        PROFILE.mkdir(parents=True, exist_ok=True)
        _, _, w, h = screen_rect()
        args = [self.edge, f"--app={URL}", f"--user-data-dir={PROFILE}", "--no-first-run", "--no-default-browser-check",
                "--disable-features=CalculateNativeWinOcclusion,Translate", "--disable-background-timer-throttling",
                "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "--disable-extensions",
                "--hide-crash-restore-bubble", "--disable-session-crashed-bubble", "--disable-sync", "--start-fullscreen",
                "--window-position=-32000,-32000", f"--window-size={w},{h}"]
        subprocess.Popen(args, creationflags=CREATE_NO_WINDOW)
        for _ in range(600):  # attach the moment the window exists, so it never sits on top of your apps
            time.sleep(0.05)
            hwnd = find_app_window()
            if hwnd:
                self.hwnd = hwnd
                self.parent = attach(hwnd)
                self.size = screen_rect()
                self.hidden = False
                return True
        log.error("Edge app window did not appear")
        return False

    def tick(self):
        if not self.hwnd or not user32.IsWindow(self.hwnd):
            log.info("wallpaper window missing → relaunch")
            return self.launch()
        if not self.parent or not user32.IsWindow(self.parent) or user32.GetParent(self.hwnd) != self.parent:
            self.hidden = False
            log.info("desktop changed → reattach")
            self.parent = attach(self.hwnd)
        rect = screen_rect()
        if rect != self.size:
            self.size = rect
            self.parent = attach(self.hwnd)
        full = foreground_is_fullscreen(self.hwnd)  # pause while a game / fullscreen video covers the desktop
        if full != self.hidden:
            self.hidden = full
            user32.ShowWindow(self.hwnd, SW_HIDE if full else SW_SHOWNA)
        return True

    def showing(self):
        return bool(self.hwnd) and not self.hidden

    def stop(self):
        kill_our_edge()
        refresh_wallpaper()


class LivelyDisplay:
    """Lively Wallpaper shows http://127.0.0.1:8770/ on the desktop (and pauses it for games / fullscreen apps).
    We only serve the town + activity data and forward desktop clicks to the page."""

    def launch(self):
        kill_our_edge()  # in case the classic Edge wallpaper was running before
        log.info("lively mode: point Lively at %s", URL)
        return True

    def tick(self):
        return True

    def showing(self):
        return True

    def stop(self):
        pass


WH_MOUSE_LL, WM_LBUTTONUP = 14, 0x0202
HOOKPROC = ctypes.WINFUNCTYPE(ctypes.c_ssize_t, ctypes.c_int, wt.WPARAM, wt.LPARAM)
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
kernel32.GetModuleHandleW.restype = wt.HMODULE
user32.SetWindowsHookExW.restype = wt.HHOOK
user32.SetWindowsHookExW.argtypes = [ctypes.c_int, HOOKPROC, wt.HINSTANCE, wt.DWORD]
user32.CallNextHookEx.restype = ctypes.c_ssize_t
user32.CallNextHookEx.argtypes = [wt.HHOOK, ctypes.c_int, wt.WPARAM, wt.LPARAM]
user32.WindowFromPoint.restype = wt.HWND
user32.WindowFromPoint.argtypes = [wt.POINT]


class MSLLHOOKSTRUCT(ctypes.Structure):
    _fields_ = [("pt", wt.POINT), ("mouseData", wt.DWORD), ("flags", wt.DWORD), ("time", wt.DWORD), ("dwExtraInfo", ctypes.c_size_t)]


def start_click_watcher(wp):
    """Clicks on the desktop land on the icon layer, not on the wallpaper. Watch for left clicks on empty desktop
    and forward their position to the town page (via /events) so clicking a resident shows its app card."""
    import queue
    import threading
    clicks = queue.Queue()

    def hook_thread():
        def proc(n, w, l):
            if n == 0 and w == WM_LBUTTONUP:
                s = ctypes.cast(l, ctypes.POINTER(MSLLHOOKSTRUCT)).contents
                clicks.put((s.pt.x, s.pt.y))
            return user32.CallNextHookEx(None, n, w, l)

        cb = HOOKPROC(proc)
        wp._hook_cb = cb  # keep alive
        if not user32.SetWindowsHookExW(WH_MOUSE_LL, cb, kernel32.GetModuleHandleW(None), 0):
            log.error("mouse hook failed: %s", ctypes.get_last_error())
            return
        msg = wt.MSG()
        while user32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
            user32.TranslateMessage(ctypes.byref(msg))
            user32.DispatchMessageW(ctypes.byref(msg))

    def worker():
        while True:
            x, y = clicks.get()
            try:
                if not wp.showing():
                    continue
                h = user32.WindowFromPoint(wt.POINT(x, y))
                root = user32.GetAncestor(h, 2) if h else None
                if root and class_name(root) in ("Progman", "WorkerW"):
                    server.broadcast({"type": "click", "x": x, "y": y})
            except Exception:
                log.exception("click forward failed")

    threading.Thread(target=hook_thread, daemon=True).start()
    threading.Thread(target=worker, daemon=True).start()


def already_running():
    try:
        with urllib.request.urlopen(f"http://{server.HOST}:{server.PORT}/health", timeout=1.5) as r:
            return json.loads(r.read()).get("app") == "desktop-buddy"
    except Exception:
        return False


def main():
    if already_running():
        log.info("already running; exiting")
        return
    server.start_server()
    log.info("agent listening on %s", URL)
    for _ in range(120):  # at sign-in, wait until Explorer has created the desktop and taskbar
        if user32.FindWindowW("Progman", None) and user32.FindWindowW("Shell_TrayWnd", None):
            break
        time.sleep(0.5)
    wp = LivelyDisplay() if "--lively" in sys.argv else Wallpaper()
    start_click_watcher(wp)
    try:
        wp.launch()
        while not server.quit_event.wait(2):
            try:
                wp.tick()
            except Exception:
                log.exception("tick failed")
    except KeyboardInterrupt:
        pass
    finally:
        wp.stop()
        log.info("stopped")


if __name__ == "__main__":
    main()
