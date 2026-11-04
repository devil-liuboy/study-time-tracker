"""Minimal Win32 observations. No key hooks, titles, screenshots or input content."""
from __future__ import annotations
import ctypes
from ctypes import wintypes as W
import os
from pathlib import Path
import subprocess
import sys
import time

if sys.platform == 'win32':
    user32 = ctypes.WinDLL('user32', use_last_error=True)
    kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
    user32.GetForegroundWindow.restype = W.HWND
    user32.GetWindowThreadProcessId.argtypes = [W.HWND, ctypes.POINTER(W.DWORD)]
    kernel32.OpenProcess.argtypes = [W.DWORD, W.BOOL, W.DWORD]
    kernel32.OpenProcess.restype = W.HANDLE
    kernel32.QueryFullProcessImageNameW.argtypes = [W.HANDLE, W.DWORD, W.LPWSTR, ctypes.POINTER(W.DWORD)]
    kernel32.CloseHandle.argtypes = [W.HANDLE]
    kernel32.GetTickCount64.restype = ctypes.c_ulonglong
    user32.OpenInputDesktop.argtypes = [W.DWORD, W.BOOL, W.DWORD]
    user32.OpenInputDesktop.restype = W.HANDLE
    user32.SwitchDesktop.argtypes = [W.HANDLE]
    user32.CloseDesktop.argtypes = [W.HANDLE]
    user32.GetWindowRect.argtypes = [W.HWND, ctypes.POINTER(W.RECT)]
    kernel32.CreateMutexW.argtypes = [ctypes.c_void_p, W.BOOL, W.LPCWSTR]
    kernel32.CreateMutexW.restype = W.HANDLE

class LASTINPUTINFO(ctypes.Structure):
    _fields_ = [('cbSize', W.UINT), ('dwTime', W.DWORD)]

class Observer:
    def __init__(self):
        self.hwnd = None
        self.changed = time.monotonic()
        self.cache = {}

    def snapshot(self):
        if sys.platform != 'win32':
            return {'now': time.time(), 'idle_seconds': 0, 'blocked': True, 'path': '', 'hwnd': 0, 'changed': time.monotonic()}
        info = LASTINPUTINFO(ctypes.sizeof(LASTINPUTINFO), 0)
        ok = user32.GetLastInputInfo(ctypes.byref(info))
        idle = ((kernel32.GetTickCount64() & 0xffffffff) - info.dwTime) & 0xffffffff
        now = time.time()
        desktop = user32.OpenInputDesktop(0, False, 0x0100)
        unlocked = bool(desktop and user32.SwitchDesktop(desktop))
        if desktop:
            user32.CloseDesktop(desktop)
        hwnd = user32.GetForegroundWindow()
        if hwnd != self.hwnd:
            self.hwnd, self.changed = hwnd, time.monotonic()
        pid = W.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        path = ''
        process = kernel32.OpenProcess(0x1000, False, pid.value)
        if process:
            try:
                size = W.DWORD(32768)
                buffer = ctypes.create_unicode_buffer(size.value)
                if kernel32.QueryFullProcessImageNameW(process, 0, buffer, ctypes.byref(size)):
                    path = buffer.value
            finally:
                kernel32.CloseHandle(process)
        return {'now': now, 'idle_seconds': idle / 1000, 'blocked': not(ok and unlocked and hwnd and path), 'path': path, 'hwnd': int(hwnd or 0), 'changed': self.changed}

def startup_command():
    if getattr(sys, 'frozen', False):
        return '"' + sys.executable + '" --background'
    return subprocess.list2cmdline([str(Path(sys.executable).with_name('pythonw.exe')), str(Path(__file__).resolve().parents[1] / 'main.py'), '--background'])

def set_autostart(enabled):
    if sys.platform != 'win32':
        raise RuntimeError('开机自启仅支持 Windows')
    import winreg
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, r'Software\Microsoft\Windows\CurrentVersion\Run') as key:
        if enabled:
            winreg.SetValueEx(key, 'StudyTimeTracker', 0, winreg.REG_SZ, startup_command())
        else:
            try:
                winreg.DeleteValue(key, 'StudyTimeTracker')
            except FileNotFoundError:
                pass

def is_autostart():
    if sys.platform != 'win32':
        return False
    import winreg
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r'Software\Microsoft\Windows\CurrentVersion\Run') as key:
            value, _ = winreg.QueryValueEx(key, 'StudyTimeTracker')
            return value == startup_command()
    except OSError:
        return False

def single_instance(name='StudyTimeTracker'):
    if sys.platform != 'win32':
        return None
    handle = kernel32.CreateMutexW(None, False, 'Local\\' + name)
    if ctypes.get_last_error() == 183:
        kernel32.CloseHandle(handle)
        return False
    return handle
