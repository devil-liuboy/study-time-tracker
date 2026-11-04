from __future__ import annotations
import csv
from datetime import datetime, timedelta, timezone
import functools
import os
from pathlib import Path
import threading
import time
from . import __version__
from .browser import BrowserBridge, PORT
from .config import Config, BROWSERS, app_id, is_video, matches_domain
from .discovery import discover_apps
from .engine import Engine
from .store import Store
from .windows import Observer, is_autostart, set_autostart

TZ = timezone(timedelta(hours=8))

def public_api(func):
    @functools.wraps(func)
    def wrapped(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except Exception as exc:
            # Errors returned to the local UI only. No diagnostics transmitted externally.
            return {'error': str(exc)}
    return wrapped

def report_bounds(options=None):
    options = options or {}
    today = datetime.now(TZ).replace(hour=0, minute=0, second=0, microsecond=0)
    mode = options.get('range', 'today')
    end = today + timedelta(days=1)
    if mode == 'week':
        start = today - timedelta(days=today.weekday())
    elif mode == 'month':
        start = today.replace(day=1)
    elif mode == 'custom':
        start = datetime.strptime(options['start'], '%Y-%m-%d').replace(tzinfo=TZ)
        end = datetime.strptime(options['end'], '%Y-%m-%d').replace(tzinfo=TZ) + timedelta(days=1)
        if end <= start or (end - start).days > 366:
            raise ValueError('请选择有效日期，范围最多 366 天')
    else:
        start = today
    return start.timestamp(), end.timestamp()

class Service:
    def __init__(self, directory, resources, test_mode=False):
        self.config = Config(directory)
        self.store = Store(Path(directory) / 'activity.sqlite3')
        self.engine = Engine(self.store)
        self.observer = Observer()
        self.browser = BrowserBridge(self.config.token)
        self.resources = Path(resources)
        self.test_mode = test_mode
        self.lock = threading.RLock()
        self.stop_event = threading.Event()
        self.paused = False
        self.error = ''
        self.scanning = False
        self.window = None
        self.on_quit = None
        self.thread = None

    def start(self):
        try:
            self.browser.start()
        except OSError:
            self.error = '浏览器连接端口 47831 被占用，网页暂不计时；桌面软件仍可统计。'
        self.thread = threading.Thread(target=self._monitor, daemon=True, name='activity-monitor')
        self.thread.start()
        if not self.config.data['initialized']:
            threading.Thread(target=self._first_run, daemon=True, name='first-run-discovery').start()

    def _first_run(self):
        self.scanning = True
        try:
            apps = discover_apps()
            with self.lock:
                # Initial scan selects only the explicitly supported core catalog.
                if not self.config.data['initialized']:
                    self.config.update_apps([app for app in apps if app['suggested']])
                    self.config.data['initialized'] = True
                    if not self.test_mode:
                        try:
                            set_autostart(True)
                            self.config.data['autostart'] = True
                        except OSError:
                            self.error = '自动启动设置未成功，可在设置中重试。'
                    self.config.save()
        except Exception:
            self.error = '自动扫描暂不可用，请在应用页重试或手动添加。'
        finally:
            self.scanning = False

    def _source(self, snapshot):
        path = snapshot['path']
        exe = Path(path).name.lower()
        config = self.config.snapshot()
        if exe in BROWSERS:
            browser = BROWSERS[exe]
            domain = self.browser.current(browser, snapshot['changed'])
            if not domain or is_video(domain):
                return None
            for site in sorted(config['websites'], key=lambda s: -len(s['domain'])):
                if site['enabled'] and matches_domain(domain, site['domain']):
                    # Aggregate subdomains under their explicitly approved parent rule.
                    return {'id': 'site:' + site['domain'], 'name': site['domain'], 'kind': 'website', 'category': site['category']}
            return None
        folded = os.path.normcase(os.path.abspath(path)) if path else ''
        for app in config['apps']:
            exact = folded == os.path.normcase(os.path.abspath(app['path']))
            package_match = False
            family = app.get('package_family', '')
            if family and '\\windowsapps\\' in folded and exe == app['exe']:
                package_name, _, publisher = family.rpartition('_')
                package_dir = next((part for part in Path(path).parts if part.lower().startswith(package_name.lower() + '_') and part.lower().endswith('__' + publisher.lower())), '')
                package_match = bool(package_dir)
            if app['enabled'] and (exact or package_match):
                return {'id': app['id'], 'name': app['name'], 'kind': 'app', 'category': app['category']}
        return None

    def _monitor(self):
        while not self.stop_event.is_set():
            try:
                snapshot = self.observer.snapshot()
                with self.lock:
                    self.engine.tick(snapshot['now'], snapshot['idle_seconds'], self._source(snapshot), blocked=snapshot['blocked'] or self.paused)
                    if self.error == '暂时无法读取当前窗口，已暂停本次采样。':
                        self.error = ''
            except Exception:
                self.error = '暂时无法读取当前窗口，已暂停本次采样。'
                with self.lock:
                    self.engine.break_observation()
            self.stop_event.wait(1)

    def stop(self):
        self.stop_event.set()
        if self.thread:
            self.thread.join(timeout=3)
        with self.lock:
            # Clicking Quit is itself real input. Validate any preceding short
            # idle spell before dropping only the unresolved final fragment.
            try:
                sample = self.observer.snapshot()
                self.engine.tick(sample['now'], sample['idle_seconds'], self._source(sample), blocked=self.paused or sample['blocked'])
            except Exception:
                pass
            self.engine.discard_pending()
        self.browser.stop()
        self.store.close()

    @public_api
    def get_state(self, options=None):
        start, end = report_bounds(options)
        with self.lock:
            report = self.store.report(start, end, self.engine.preview_intervals())
            status = dict(self.engine.status)
            source = status.get('source') or {}
            status.update(paused=self.paused, current_name=source.get('name', ''), browser_connected=self.browser.connected(), message=self.error or ('正在发现本机学习软件…' if self.scanning else ''), scanning=self.scanning)
            config = self.config.snapshot()
            config['autostart'] = is_autostart() if not self.test_mode else config['autostart']
        return {'report': report, 'status': status, 'config': config, 'version': __version__}

    @public_api
    def set_paused(self, value):
        with self.lock:
            self.paused = bool(value)
            # A deliberate pause must take effect now, not after the next timer tick.
            sample = self.observer.snapshot()
            self.engine.tick(sample['now'], sample['idle_seconds'], self._source(sample), blocked=self.paused or sample['blocked'])
        return {'ok': True, 'paused': self.paused}

    @public_api
    def scan_apps(self):
        return discover_apps(self.config.snapshot()['apps'])

    @public_api
    def save_apps(self, apps):
        with self.lock:
            self.config.update_apps(apps)
            self.config.data['initialized'] = True
            self.config.save()
        return {'ok': True}

    @public_api
    def browse_app(self):
        import webview
        chosen = self.window.create_file_dialog(webview.FileDialog.OPEN, allow_multiple=False, file_types=('Windows 应用 (*.exe)',))
        if not chosen:
            return None
        path = chosen[0]
        return {'id': app_id(path), 'name': Path(path).stem, 'path': path, 'exe': Path(path).name.lower(), 'category': '自定义软件', 'enabled': True}

    @public_api
    def save_websites(self, sites):
        self.config.update_websites(sites)
        return {'ok': True}

    @public_api
    def add_manual(self, value):
        with self.lock:
            ident = self.store.add_manual(value['date'], float(value['minutes']) * 60, value.get('name', '手动修正'), value.get('category', '手动修正'))
        return {'ok': True, 'id': ident}

    @public_api
    def delete_manual(self, ident):
        with self.lock:
            self.store.delete_manual(int(ident))
        return {'ok': True}

    @public_api
    def export_csv(self, options=None):
        import webview
        start, end = report_bounds(options)
        chosen = self.window.create_file_dialog(webview.FileDialog.SAVE, save_filename='学习时长_' + datetime.now(TZ).strftime('%Y%m%d') + '.csv', file_types=('CSV 文件 (*.csv)',))
        if not chosen:
            return {'ok': False}
        path = chosen if isinstance(chosen, str) else chosen[0]
        # Export confirmed records only; provisional time can still be rolled back.
        report = self.store.report(start, end)
        def safe(value):
            text = str(value)
            return "'" + text if text.startswith(('=', '+', '-', '@', '\t', '\r')) else text
        with open(path, 'w', newline='', encoding='utf-8-sig') as stream:
            writer = csv.writer(stream)
            writer.writerow(['开始时间（北京时间）', '结束时间（北京时间）', '应用或网站', '类型', '分类', '秒数', '手动修正'])
            for row in report['sessions']:
                writer.writerow([datetime.fromtimestamp(row['start'], TZ).isoformat(), datetime.fromtimestamp(row['end'], TZ).isoformat(), safe(row['name']), row['kind'], safe(row['category']), round(row['seconds'], 3), '是' if row['manual'] else '否'])
        return {'ok': True, 'path': path}

    @public_api
    def set_autostart(self, enabled):
        if self.test_mode:
            raise ValueError('测试实例不修改登录自启设置')
        set_autostart(bool(enabled))
        self.config.data['autostart'] = is_autostart()
        self.config.save()
        return {'ok': True, 'enabled': self.config.data['autostart']}

    @public_api
    def get_browser_setup(self):
        return {'token': self.config.token, 'port': PORT, 'extension_path': str(self.resources / 'extension')}

    @public_api
    def open_data_folder(self):
        os.startfile(str(self.config.directory))
        return {'ok': True}

    @public_api
    def open_extension_folder(self):
        os.startfile(str(self.resources / 'extension'))
        return {'ok': True}

    @public_api
    def quit_app(self):
        if self.on_quit:
            self.on_quit()
        return {'ok': True}
