"""Bounded installed-app discovery; never opens user documents or browser profiles."""
from __future__ import annotations
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from .config import app_id, package_family_from_path, BROWSERS

CATALOG = [
    ('Codex', ('codex', 'openai.codex'), ('codex.exe', 'chatgpt.exe', 'chatgpt-desktop.exe'), 'AI 助手', True),
    ('Claude', ('claude',), ('claude.exe',), 'AI 助手', True),
    ('Cursor', ('cursor',), ('cursor.exe',), 'AI 编程', True),
    ('Antigravity', ('antigravity',), ('antigravity.exe',), 'AI 编程', True),
    ('OpenCode', ('opencode',), ('opencode.exe',), 'AI 编程', True),
    ('WorkBuddy', ('workbuddy',), ('workbuddy.exe',), 'AI 助手', True),
    ('Cherry Studio', ('cherry studio',), ('cherry studio.exe',), 'AI 助手', True),
    ('VS Code', ('visual studio code', 'microsoft vs code'), ('code.exe',), '编程开发', True),
    ('PyCharm', ('pycharm',), ('pycharm64.exe', 'pycharm.exe'), '编程开发', True),
    ('IntelliJ IDEA', ('intellij idea',), ('idea64.exe', 'idea.exe'), '编程开发', True),
    ('Eclipse', ('eclipse',), ('eclipse.exe',), '编程开发', True),
    ('Dev-C++', ('dev-c++', 'dev-cpp'), ('devcpp.exe',), '编程开发', True),
    ('Zotero', ('zotero',), ('zotero.exe',), '文献阅读', True),
    ('Obsidian', ('obsidian',), ('obsidian.exe',), '知识笔记', True),
    ('Readest', ('readest',), ('readest.exe',), '阅读', False),
    ('Word', ('word',), ('winword.exe',), '文档办公', False),
    ('Excel', ('excel',), ('excel.exe',), '文档办公', False),
    ('PowerPoint', ('powerpoint',), ('powerpnt.exe',), '文档办公', False),
    ('OneNote', ('onenote',), ('onenote.exe',), '知识笔记', False),
    ('WPS 文字', ('wps office',), ('wps.exe',), '文档办公', False),
    ('WPS 表格', ('wps office',), ('et.exe',), '文档办公', False),
    ('WPS 演示', ('wps office',), ('wpp.exe',), '文档办公', False),
    ('OrcaTerm', ('orcaterm',), ('orcaterm.exe',), '终端', False),
    ('Windows Terminal', ('windows terminal',), ('windowsterminal.exe',), '终端', False),
    ('VMware', ('vmware',), ('vmware.exe', 'vmplayer.exe'), '虚拟机', False),
    ('Windsurf', ('windsurf',), ('windsurf.exe',), 'AI 编程', False),
    ('Trae', ('trae',), ('trae.exe',), 'AI 编程', False),
    ('Notion', ('notion',), ('notion.exe',), '知识笔记', False),
    ('Typora', ('typora',), ('typora.exe',), '知识笔记', False),
    ('Visual Studio', ('visual studio',), ('devenv.exe',), '编程开发', False),
    ('RStudio', ('rstudio',), ('rstudio.exe',), '编程开发', False),
]

def classify(name, path):
    text, exe = name.lower(), Path(path).name.lower()
    for label, hints, executables, category, suggested in CATALOG:
        if exe in executables and (any(hint in text for hint in hints) or exe not in ('chatgpt.exe', 'chatgpt-desktop.exe')):
            return label, category, suggested
    return None

def _powershell_inventory():
    # This script reads only shortcut targets and package metadata. No shortcut is executed.
    script = r'''
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    $ErrorActionPreference = 'SilentlyContinue'
    $rows = @()
    $menus = @([Environment]::GetFolderPath('StartMenu'), [Environment]::GetFolderPath('CommonStartMenu'))
    $shell = New-Object -ComObject WScript.Shell
    foreach ($menu in $menus) {
      Get-ChildItem -LiteralPath $menu -Filter *.lnk -File -Recurse | ForEach-Object {
        $link = $shell.CreateShortcut($_.FullName)
        if ($link.TargetPath -like '*.exe') { $rows += @{ name=$_.BaseName; path=$link.TargetPath } }
      }
    }
    Get-AppxPackage | Where-Object { $_.Name -match 'Codex|Claude|ChatGPT|WindowsTerminal' } | ForEach-Object {
      $package = $_
      @($package.InstallLocation, (Join-Path $package.InstallLocation 'app')) | ForEach-Object {
        Get-ChildItem -LiteralPath $_ -Filter *.exe -File | ForEach-Object {
          $rows += @{name=$package.Name; path=$_.FullName; package_family=$package.PackageFamilyName}
        }
      }
    }
    ConvertTo-Json -InputObject @($rows) -Compress
    '''
    try:
        result = subprocess.run(['powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], capture_output=True, encoding='utf-8-sig', errors='replace', timeout=45, creationflags=0x08000000)
        return json.loads(result.stdout or '[]')
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return []

def _registry_locations():
    import winreg
    rows = []
    for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
        for view in (winreg.KEY_WOW64_64KEY, winreg.KEY_WOW64_32KEY):
            try:
                with winreg.OpenKey(hive, r'SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall', 0, winreg.KEY_READ | view) as key:
                    for n in range(winreg.QueryInfoKey(key)[0]):
                        try:
                            with winreg.OpenKey(key, winreg.EnumKey(key, n)) as app:
                                name = winreg.QueryValueEx(app, 'DisplayName')[0]
                                matches = [entry for entry in CATALOG if any(h in name.lower() for h in entry[1])]
                                if not matches:
                                    continue
                                try:
                                    location = winreg.QueryValueEx(app, 'InstallLocation')[0].strip('" ')
                                except OSError:
                                    location = ''
                                try:
                                    icon = winreg.QueryValueEx(app, 'DisplayIcon')[0]
                                    icon = re.sub(r',-?\d+$', '', icon).strip('" ')
                                    if icon.lower().endswith('.exe'):
                                        rows.append({'name': name, 'path': icon})
                                except OSError:
                                    pass
                                if location:
                                    for entry in matches:
                                        for executable in entry[2]:
                                            for sub in ('', 'bin', 'app'):
                                                rows.append({'name': name, 'path': str(Path(location) / sub / executable)})
                        except OSError:
                            continue
            except OSError:
                continue
    return rows

def discover_apps(existing=None):
    if sys.platform != 'win32':
        return []
    existing = {item['id']: item for item in existing or []}
    candidates = _powershell_inventory() + _registry_locations()
    roots = [Path(os.environ.get('LOCALAPPDATA', '')) / 'Programs', Path(os.environ.get('ProgramFiles', 'C:/Program Files')), Path(os.environ.get('ProgramFiles(x86)', 'C:/Program Files (x86)'))]
    # Only inspect bounded, matching installation folders and one executable subfolder.
    for root in roots:
        try:
            for directory in root.iterdir():
                matching = [item for item in CATALOG if any(h in directory.name.lower() for h in item[1])]
                for item in matching:
                    for exe in item[2]:
                        for sub in ('', 'bin', 'app'):
                            candidates.append({'name': item[0], 'path': str(directory / sub / exe)})
        except OSError:
            pass
    result = {}
    codex_families_with_gui = {package_family_from_path(item.get('path', '')) for item in candidates
        if Path(item.get('path', '')).name.lower() == 'chatgpt.exe'
        and 'codex' in item.get('name', '').lower() and Path(item.get('path', '')).is_file()}
    for item in candidates:
        path = item.get('path', '')
        match = classify(item.get('name', ''), path)
        if not match or not Path(path).is_file() or Path(path).name.lower() in BROWSERS:
            continue
        # The Codex MSIX includes a separate command-line launcher; its GUI is
        # ChatGPT.exe in current packages. Don't list the launcher as a second app.
        if (match[0] == 'Codex' and Path(path).name.lower() in ('codex.exe', 'chatgpt-desktop.exe')
                and package_family_from_path(path) in codex_families_with_gui):
            continue
        name, category, suggested = match
        row = {'id': app_id(path), 'name': name, 'path': path, 'exe': Path(path).name.lower(), 'category': category, 'suggested': suggested, 'enabled': suggested}
        family = item.get('package_family') or package_family_from_path(path)
        if family:
            row['package_family'] = family
        if row['id'] in existing:
            row['enabled'] = existing[row['id']]['enabled']
        # Prefer package-aware record when same executable occurs via shortcut and package.
        result[row['id']] = {**result.get(row['id'], {}), **row}
    for ident, row in existing.items():
        if ident not in result:
            result[ident] = {**row, 'suggested': False}
    return sorted(result.values(), key=lambda row: (not row.get('suggested', False), row['name'].casefold(), row['path'].casefold()))
