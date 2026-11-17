"""PDF/Office discovery with fake installs, without inspecting user documents."""
import sys
from pathlib import Path

import pytest

from studytime.config import app_id, wps_identity
from studytime import discovery
from studytime.service import Service


@pytest.mark.parametrize('exe', [
    'wpspdf.exe', 'wps.exe', 'et.exe', 'wpp.exe', 'readest.exe',
    'Acrobat.exe', 'AcroRd32.exe', 'FoxitPDFReader.exe', 'FoxitReader.exe',
    'FoxitPDFEditor.exe', 'SumatraPDF.exe', 'PDFXEdit.exe', 'PDFXCview.exe',
    'PDFgear.exe', 'UPDF.exe', 'Xodo.exe', 'okular.exe', 'CAJViewer.exe',
])
def test_readers_and_wps_modules_are_recommended(exe):
    assert discovery.classify('Installed app', exe)[2] is True


@pytest.mark.parametrize('exe', ['chrome.exe', 'msedge.exe', 'ksolaunch.exe',
                                      'pdf_update.exe', 'winword.exe', 'et.exe.bak'])
def test_browser_launcher_updater_and_unrelated_office_not_auto_enabled(exe):
    result = discovery.classify('WPS Office PDF reader', exe)
    assert result is None or not result[2]


@pytest.mark.skipif(sys.platform != 'win32', reason='Windows discovery and path semantics')
def test_wps_launcher_discovers_modules_deduplicates_versions_and_preserves_disabled(tmp_path, monkeypatch):
    root = tmp_path / 'WPS Office'
    root.mkdir()
    launcher = root / 'ksolaunch.exe'
    launcher.touch()
    for version in ('12.1.0.9', '12.1.0.10'):
        folder = root / version / 'office6'
        folder.mkdir(parents=True)
        for exe in ('wpspdf.exe', 'wps.exe', 'et.exe', 'wpp.exe', 'update.exe'):
            (folder / exe).touch()
    old_pdf = root / '12.1.0.9' / 'office6' / 'wpspdf.exe'
    old_rule = {'id': 'legacy-path-id', 'name': 'WPS PDF', 'path': str(old_pdf),
                'exe': 'wpspdf.exe', 'enabled': False, 'category': 'PDF 阅读'}
    monkeypatch.setattr(discovery, '_powershell_inventory', lambda: [{'name': 'WPS Office', 'path': str(launcher)}])
    monkeypatch.setattr(discovery, '_registry_locations', lambda: [])
    for variable in ('LOCALAPPDATA', 'ProgramFiles', 'ProgramFiles(x86)'):
        monkeypatch.setenv(variable, str(tmp_path / 'empty'))
    rows = discovery.discover_apps([old_rule])
    assert len(rows) == 4
    assert {row['exe'] for row in rows} == {'wpspdf.exe', 'wps.exe', 'et.exe', 'wpp.exe'}
    assert all('12.1.0.10' in row['path'] for row in rows)
    assert next(row for row in rows if row['exe'] == 'wpspdf.exe')['enabled'] is False
    assert all(row['id'] == app_id(row['path']) for row in rows)


def test_registry_layout_probe_finds_acrobat_and_pdf_xchange_but_not_arbitrary_depth(tmp_path):
    acrobat = {Path(row['path']) for row in discovery._installation_candidates('Adobe Acrobat DC', tmp_path)}
    assert tmp_path / 'Acrobat' / 'acrobat.exe' in acrobat
    viewer = {Path(row['path']) for row in discovery._installation_candidates('Tracker Software', tmp_path)}
    assert tmp_path / 'PDF Editor' / 'pdfxedit.exe' in viewer
    assert tmp_path / 'private' / 'deep' / 'pdfxedit.exe' not in viewer


def test_wps_upgrade_matches_only_enabled_module_within_same_install_root(tmp_path):
    old = tmp_path / 'WPS Office' / '12.1.0.9' / 'office6' / 'wpspdf.exe'
    new = tmp_path / 'WPS Office' / '12.1.0.10' / 'office6' / 'wpspdf.exe'
    assert app_id(str(old)) == app_id(str(new))
    service = Service(tmp_path / 'data', tmp_path, test_mode=True)
    try:
        service.config.update_apps([{'path': str(old), 'name': 'WPS PDF', 'category': 'PDF 阅读', 'enabled': True}])
        sample = lambda path: {'path': str(path), 'changed': 0}
        assert service._source(sample(new))['name'] == 'WPS PDF'
        assert service._source(sample(new.with_name('wps.exe'))) is None
        assert service._source(sample(tmp_path / 'other' / new.relative_to(tmp_path))) is None
        assert service._source(sample(tmp_path / 'wpspdf.exe')) is None
        rule = service.config.snapshot()['apps'][0]
        service.config.update_apps([{**rule, 'enabled': False}])
        assert service._source(sample(new)) is None
        assert wps_identity(str(old).replace('12.1.0.9', 'random')) == ''
    finally:
        service.browser.stop()
        service.store.close()
