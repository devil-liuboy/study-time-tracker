from __future__ import annotations
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import threading

SITES = {
    '论文与代码': ['arxiv.org', 'github.com', 'huggingface.co'],
    '学术检索': ['scholar.google.com', 'semanticscholar.org', 'openreview.net', 'dblp.org', 'dl.acm.org', 'ieeexplore.ieee.org'],
    '技术文档': ['docs.python.org', 'pytorch.org', 'developer.mozilla.org', 'learn.microsoft.com', 'docs.nvidia.com', 'docs.docker.com'],
    'AI 助手': ['chatgpt.com', 'claude.ai', 'gemini.google.com', 'chat.deepseek.com'],
}
VIDEO_DOMAINS = ('bilibili.com', 'b23.tv', 'youtube.com', 'youtu.be', 'douyin.com', 'ixigua.com', 'youku.com', 'v.qq.com', 'twitch.tv', 'douyu.com', 'huya.com')
BROWSERS = {'chrome.exe': 'chrome', 'msedge.exe': 'edge', 'firefox.exe': 'unsupported', 'brave.exe': 'unsupported', 'slbrowser.exe': 'unsupported', 'quark.exe': 'unsupported'}

def normalize_domain(value):
    if not isinstance(value, str):
        raise ValueError('请填写域名，例如 arxiv.org')
    value = value.strip().lower().rstrip('.')
    if len(value) > 253 or not value or any(c in value for c in '/:@?#*\\'):
        raise ValueError('只填写域名，不包含网址路径、端口或通配符')
    try:
        value = value.encode('idna').decode('ascii')
    except UnicodeError as exc:
        raise ValueError('域名格式错误') from exc
    if '.' not in value or not all(re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', label) for label in value.split('.')):
        raise ValueError('域名格式错误')
    return value

def matches_domain(domain, rule):
    return domain == rule or domain.endswith('.' + rule)

def is_video(domain):
    return any(matches_domain(domain, rule) for rule in VIDEO_DOMAINS)

def package_family_from_path(path):
    match = re.search(r'(?i)[\\/]WindowsApps[\\/]([^\\/]+)_\d+\.\d+\.\d+\.\d+_(?:x64|x86|arm64|neutral)__([^\\/]+)[\\/]', path)
    return match.group(1) + '_' + match.group(2) if match else ''

def app_id(path, package_family=None):
    family = package_family or package_family_from_path(path)
    identity = ('msix:' + family.lower() + ':' + Path(path).name.lower()) if family else os.path.normcase(os.path.abspath(path))
    return 'app:' + hashlib.sha256(identity.encode()).hexdigest()[:20]

def clean_text(value, label, limit, fallback=''):
    text = str(value).strip() or fallback
    if not text or len(text) > limit or any(ord(char) < 32 for char in text):
        raise ValueError(label + '不能为空、过长或包含控制字符')
    return text

class Config:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.path = self.directory / 'settings.json'
        self.lock = threading.RLock()
        self.data = {'schema': 1, 'apps': [], 'websites': [{'domain': d, 'category': c, 'enabled': True} for c, ds in SITES.items() for d in ds], 'autostart': False, 'initialized': False}
        if self.path.exists():
            # Never silently overwrite a broken configuration.
            saved = json.loads(self.path.read_text(encoding='utf-8'))
            self.data.update(saved)
        token_path = self.directory / 'browser-token.txt'
        if not token_path.exists():
            token_path.write_text(secrets.token_hex(32), encoding='ascii')
        self.token = token_path.read_text(encoding='ascii').strip()
        self.save()

    def save(self):
        with self.lock:
            tmp = self.path.with_suffix('.tmp')
            tmp.write_text(json.dumps(self.data, ensure_ascii=False, indent=2), encoding='utf-8')
            tmp.replace(self.path)

    def snapshot(self):
        with self.lock:
            return copy.deepcopy(self.data)

    def update_apps(self, apps):
        if not isinstance(apps, list) or len(apps) > 1000:
            raise ValueError('软件列表无效')
        clean = {}
        for item in apps:
            path = str(item.get('path', '')).strip()
            if not path.lower().endswith('.exe') or not os.path.isabs(path):
                raise ValueError('请选择软件的完整 .exe 路径')
            exe = Path(path).name.lower()
            if exe in BROWSERS:
                raise ValueError('浏览器应通过网站白名单统计，不能作为整个应用纳入')
            name = clean_text(item.get('name', Path(path).stem), '软件名称', 100)
            category = clean_text(item.get('category', '自定义软件'), '分类', 40, '自定义软件')
            record = {'id': app_id(path), 'name': name, 'path': path, 'exe': exe, 'category': category, 'enabled': bool(item.get('enabled', True))}
            # MSIX paths change on app upgrades; preserve the verified package family.
            family = package_family_from_path(path) or item.get('package_family')
            if isinstance(family, str) and re.fullmatch(r'[A-Za-z0-9._-]+', family):
                record['package_family'] = family
            clean[record['id']] = record
        with self.lock:
            self.data['apps'] = list(clean.values())
            self.save()

    def update_websites(self, sites):
        if not isinstance(sites, list) or len(sites) > 1000:
            raise ValueError('网站列表无效')
        clean = {}
        for item in sites:
            domain = normalize_domain(item['domain'])
            if is_video(domain):
                raise ValueError('视频网站固定排除，不能加入学习白名单')
            category = clean_text(item.get('category', '学习网站'), '分类', 40, '学习网站')
            clean[domain] = {'domain': domain, 'category': category, 'enabled': bool(item.get('enabled', True))}
        with self.lock:
            self.data['websites'] = list(clean.values())
            self.save()
