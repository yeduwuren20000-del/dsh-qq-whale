# -*- coding: utf-8 -*-
"""大肥鱼的「手」之二：本机桌面窗口控制。

只做能在无人值守下安全做的事：列窗口、切前台、截图、打字、快捷键、点击。
不注入进程、不读内存、不做任何需要管理员权限的操作。

用法（由 lib/desktop.js 调用，参数一律 argv，不经过 shell）：
    python desktop.py windows '{}'
    python desktop.py focus '{"title":"QQ"}'
    python desktop.py shot  '{"out":"C:/x/y.png"}'
    python desktop.py type  '{"text":"你好"}'
    python desktop.py hotkey '{"keys":"ctrl+s"}'
    python desktop.py click '{"x":100,"y":200}'
输出一行 JSON：{"ok": true, "text": "...", ...}
"""
import json
import os
import sys
import time

try:
    import pyautogui
    pyautogui.FAILSAFE = False
except Exception as error:  # noqa: BLE001
    pyautogui = None
    PYAUTOGUI_ERROR = str(error)

try:
    import win32con
    import win32gui
except Exception:  # noqa: BLE001
    win32gui = None
    win32con = None


def emit(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))
    sys.stdout.flush()


def visible_windows():
    if win32gui is None:
        raise RuntimeError("没有 pywin32，列不了窗口")
    rows = []

    def collect(hwnd, _):
        if not win32gui.IsWindowVisible(hwnd):
            return
        title = win32gui.GetWindowText(hwnd)
        if not title.strip():
            return
        left, top, right, bottom = win32gui.GetWindowRect(hwnd)
        rows.append(
            {
                "title": title,
                "hwnd": hwnd,
                "rect": [left, top, right - left, bottom - top],
            }
        )

    win32gui.EnumWindows(collect, None)
    rows.sort(key=lambda row: row["rect"][2] * row["rect"][3], reverse=True)
    return rows


def find_window(keyword):
    keyword = (keyword or "").strip().lower()
    for row in visible_windows():
        if keyword in row["title"].lower():
            return row
    return None


def do_focus(params):
    keyword = params.get("title") or params.get("keyword") or ""
    row = find_window(keyword)
    if row is None:
        return {"ok": False, "text": "没找到标题包含「%s」的窗口" % keyword}
    hwnd = row["hwnd"]
    if win32gui.IsIconic(hwnd):
        win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
    try:
        win32gui.SetForegroundWindow(hwnd)
    except Exception:  # noqa: BLE001
        # Windows 会拒绝非前台进程抢焦点，退化成先最小化再恢复。
        win32gui.ShowWindow(hwnd, win32con.SW_MINIMIZE)
        win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
    time.sleep(float(params.get("wait") or 0.4))
    return {"ok": True, "text": "已切到窗口：%s" % row["title"], "rect": row["rect"]}


def do_shot(params):
    if pyautogui is None:
        return {"ok": False, "text": "截图不可用：%s" % PYAUTOGUI_ERROR}
    out = params.get("out")
    if not out:
        return {"ok": False, "text": "需要 out 路径"}
    os.makedirs(os.path.dirname(out), exist_ok=True)
    image = pyautogui.screenshot()
    image.save(out)
    return {"ok": True, "text": "截图已存：%s" % os.path.basename(out), "size": list(image.size)}


def do_type(params):
    if pyautogui is None:
        return {"ok": False, "text": "键盘不可用：%s" % PYAUTOGUI_ERROR}
    text = params.get("text") or ""
    if not text:
        return {"ok": False, "text": "没有要输入的内容"}
    interval = float(params.get("interval") or 0.02)
    # 中文/emoji 走 typewrite 会丢，逐字用剪贴板更稳。
    if any(ord(ch) > 127 for ch in text):
        try:
            import pyperclip

            pyperclip.copy(text)
            pyautogui.hotkey("ctrl", "v")
            time.sleep(float(params.get("wait") or 0.3))
            return {"ok": True, "text": "已通过剪贴板粘贴 %d 个字符" % len(text)}
        except Exception:  # noqa: BLE001
            pass
    pyautogui.typewrite(text, interval=interval)
    return {"ok": True, "text": "已输入 %d 个字符" % len(text)}


def do_hotkey(params):
    if pyautogui is None:
        return {"ok": False, "text": "键盘不可用：%s" % PYAUTOGUI_ERROR}
    keys = [part.strip() for part in str(params.get("keys") or "").split("+") if part.strip()]
    if not keys:
        return {"ok": False, "text": "keys 形如 ctrl+s"}
    pyautogui.hotkey(*keys)
    time.sleep(float(params.get("wait") or 0.3))
    return {"ok": True, "text": "已按下：" + "+".join(keys)}


def do_click(params):
    if pyautogui is None:
        return {"ok": False, "text": "鼠标不可用：%s" % PYAUTOGUI_ERROR}
    x, y = int(params.get("x") or 0), int(params.get("y") or 0)
    pyautogui.click(x=x, y=y, clicks=int(params.get("clicks") or 1))
    time.sleep(float(params.get("wait") or 0.3))
    return {"ok": True, "text": "已点击 (%d, %d)" % (x, y)}


def main():
    action = sys.argv[1] if len(sys.argv) > 1 else "windows"
    try:
        params = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
    except Exception:  # noqa: BLE001
        params = {}

    if action == "windows":
        rows = visible_windows()
        listing = "\n".join(
            "- %s  [%d,%d %dx%d]" % (row["title"][:60], row["rect"][0], row["rect"][1], row["rect"][2], row["rect"][3])
            for row in rows[:40]
        )
        emit({"ok": True, "text": listing or "没有可见窗口", "windows": rows[:40]})
        return

    handlers = {
        "focus": do_focus,
        "shot": do_shot,
        "type": do_type,
        "hotkey": do_hotkey,
        "click": do_click,
    }
    handler = handlers.get(action)
    if handler is None:
        emit({"ok": False, "text": "未知动作：%s" % action})
        return
    try:
        emit(handler(params))
    except Exception as error:  # noqa: BLE001
        emit({"ok": False, "text": "执行失败：%s" % error})


if __name__ == "__main__":
    main()
