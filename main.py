from __future__ import annotations
import argparse
import ctypes
import os
from pathlib import Path
import sys
import threading
from types import SimpleNamespace

def main():
    parser = argparse.ArgumentParser(description='学习时长统计系统')
    parser.add_argument('--background', action='store_true')
    parser.add_argument('--data-dir', type=Path, help='Isolated data directory; disables autostart changes for testing')
    args = parser.parse_args()
    if sys.platform != 'win32':
        raise SystemExit('This desktop application currently supports Windows 10/11 only.')
    from studytime.windows import single_instance
    mutex_name = 'StudyTimeTracker' + ('-test' if args.data_dir else '')
    mutex = single_instance(mutex_name)
    if mutex is False:
        ctypes.windll.user32.MessageBoxW(None, '程序已在运行，请从系统托盘打开。', '学习时长统计系统', 0x40)
        return
    resources = Path(getattr(sys, '_MEIPASS', Path(__file__).resolve().parent))
    data_dir = args.data_dir or Path(os.environ['LOCALAPPDATA']) / 'StudyTimeTracker'
    data_dir.mkdir(parents=True, exist_ok=True)
    import webview
    import pystray
    from PIL import Image, ImageDraw
    from studytime.service import Service
    service = Service(data_dir, resources, test_mode=bool(args.data_dir))
    # A narrow facade avoids exposing native handles, tokens or internal service
    # objects through pywebview's recursive object inspection.
    api_names = ('get_state', 'set_paused', 'scan_apps', 'save_apps', 'browse_app',
        'save_websites', 'add_manual', 'delete_manual', 'export_csv', 'set_autostart',
        'get_browser_setup', 'open_data_folder', 'open_extension_folder', 'quit_app')
    api = SimpleNamespace(**{name: getattr(service, name) for name in api_names})
    window = webview.create_window('学习时长统计系统', str(resources / 'web' / 'index.html'), js_api=api,
        width=1200, height=820, min_size=(980, 680), background_color='#f5f5f7', hidden=args.background,
        text_select=True)
    service.window = window
    state = {'quitting': False}
    def show(*_):
        window.show()
        window.restore()
    def pause(*_):
        service.set_paused(not service.paused)
        icon.update_menu()
    def quit_app(*_):
        state['quitting'] = True
        icon.stop()
        window.destroy()
    def closing():
        if not state['quitting']:
            window.hide()
            return False
        return True
    picture = Image.new('RGBA', (64, 64), (0, 0, 0, 0))
    draw = ImageDraw.Draw(picture)
    draw.rounded_rectangle((2, 2, 62, 62), radius=16, fill='#0071e3')
    draw.arc((13, 13, 51, 51), 0, 360, fill='white', width=4)
    draw.line((32, 20, 32, 33, 43, 38), fill='white', width=4)
    icon = pystray.Icon('StudyTimeTracker', picture, '学习时长统计系统', menu=pystray.Menu(
        pystray.MenuItem('打开统计面板', show, default=True),
        pystray.MenuItem(lambda _: '恢复统计' if service.paused else '暂停统计', pause),
        pystray.MenuItem('退出', quit_app)))
    service.on_quit = quit_app
    window.events.closing += closing

    def loaded():
        # Keep login startup tray-only even if WebView2 briefly creates the
        # native form while loading. The tray menu is the only way to reveal
        # the panel in background mode.
        if args.background:
            window.hide()
        else:
            window.show()

    window.events.loaded += loaded

    def started():
        icon.run_detached()
        service.start()
        # Belt-and-suspenders protection for WebView2 implementations that
        # create the native form before the loaded event is dispatched.
        if args.background:
            window.hide()
    try:
        webview.start(started, gui='edgechromium', private_mode=True, storage_path=str(data_dir / 'webview'), debug=False)
    finally:
        icon.stop()
        service.stop()

if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        if sys.platform == 'win32':
            ctypes.windll.user32.MessageBoxW(None, '启动失败：' + str(exc) + '\n请确认已安装 Microsoft Edge WebView2 Runtime。', '学习时长统计系统', 0x10)
        else:
            raise
