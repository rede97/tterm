"""Microsoft Pinyin: SendInput scancodes for 中文 + 输入法.

Called by bun after the Agent tab is focused. Does not click chrome,
does not clipboard, does not write Unicode. Window must already be
foreground with IME = 中文.
"""

from __future__ import annotations

import argparse
import ctypes
import sys
import time
from ctypes import wintypes

if sys.platform != "win32":
    sys.stderr.write("ime_pinyin.py is Windows-only (SendInput)\n")
    sys.exit(1)

KEYEVENTF_SCANCODE = 0x0008
KEYEVENTF_KEYUP = 0x0002
INPUT_KEYBOARD = 1
MAPVK_VK_TO_VSC = 0
VK_SPACE = 0x20

ULONG_PTR = ctypes.c_ulonglong if ctypes.sizeof(ctypes.c_void_p) == 8 else ctypes.c_ulong

user32 = ctypes.WinDLL("user32", use_last_error=True)
user32.MapVirtualKeyW.argtypes = [wintypes.UINT, wintypes.UINT]
user32.MapVirtualKeyW.restype = wintypes.UINT
user32.SendInput.argtypes = [wintypes.UINT, ctypes.c_void_p, ctypes.c_int]
user32.SendInput.restype = wintypes.UINT


class KEYBDINPUT(ctypes.Structure):
    _fields_ = [
        ("wVk", wintypes.WORD),
        ("wScan", wintypes.WORD),
        ("dwFlags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ULONG_PTR),
    ]


class MOUSEINPUT(ctypes.Structure):
    _fields_ = [
        ("dx", wintypes.LONG),
        ("dy", wintypes.LONG),
        ("mouseData", wintypes.DWORD),
        ("dwFlags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ULONG_PTR),
    ]


class HARDWAREINPUT(ctypes.Structure):
    _fields_ = [
        ("uMsg", wintypes.DWORD),
        ("wParamL", wintypes.WORD),
        ("wParamH", wintypes.WORD),
    ]


class INPUTUNION(ctypes.Union):
    _fields_ = [("ki", KEYBDINPUT), ("mi", MOUSEINPUT), ("hi", HARDWAREINPUT)]


class INPUT(ctypes.Structure):
    _fields_ = [("type", wintypes.DWORD), ("union", INPUTUNION)]


def _tap_scan(scan: int) -> None:
    def send(flags: int) -> None:
        inp = INPUT()
        inp.type = INPUT_KEYBOARD
        inp.union.ki = KEYBDINPUT(0, scan, KEYEVENTF_SCANCODE | flags, 0, 0)
        n = user32.SendInput(1, ctypes.byref(inp), ctypes.sizeof(INPUT))
        if n != 1:
            raise OSError(f"SendInput failed ({ctypes.get_last_error()})")

    send(0)
    time.sleep(0.018)
    send(KEYEVENTF_KEYUP)


def tap_vk(vk: int, gap: float) -> None:
    scan = user32.MapVirtualKeyW(vk, MAPVK_VK_TO_VSC)
    if scan == 0:
        raise OSError(f"MapVirtualKeyW failed for vk=0x{vk:02x}")
    _tap_scan(scan)
    time.sleep(gap)


def type_letters(text: str, gap: float) -> None:
    for ch in text:
        if ch == " ":
            tap_vk(VK_SPACE, gap)
            continue
        if not ("a" <= ch <= "z"):
            raise ValueError(f"only lowercase a-z and space: {ch!r}")
        tap_vk(ord(ch.upper()), gap)


def main() -> int:
    p = argparse.ArgumentParser(description="TSF pinyin via SendInput scancodes")
    p.add_argument("--delay-ms", type=int, default=70, help="gap between keys (fast 3s take)")
    p.add_argument("--word-pause-ms", type=int, default=120, help="pause after Space commit")
    p.add_argument("--warmup-ms", type=int, default=200, help="wait after focus before first key")
    args = p.parse_args()
    gap = args.delay_ms / 1000.0
    word_pause = args.word_pause_ms / 1000.0
    time.sleep(args.warmup_ms / 1000.0)
    # 中文
    type_letters("zhongwen", gap)
    tap_vk(VK_SPACE, word_pause)
    # 输入法
    type_letters("shurufa", gap)
    tap_vk(VK_SPACE, word_pause)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
