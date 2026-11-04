[CmdletBinding()]
param(
    [string]$Python = 'python',
    [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$projectRoot = [IO.Path]::GetFullPath($PSScriptRoot)

function Assert-ProjectOutput {
    param([Parameter(Mandatory)][string]$Path)
    $full = [IO.Path]::GetFullPath($Path)
    $prefix = $projectRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if (-not $full.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Build output must remain inside the project: $full"
    }
    $probe = $full
    while ($probe -and $probe.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
        if (Test-Path -LiteralPath $probe) {
            $item = Get-Item -LiteralPath $probe -Force
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
                throw "Refusing to build through a linked output path: $probe"
            }
        }
        $probe = Split-Path -Path $probe -Parent
    }
    return $full
}

Push-Location -LiteralPath $projectRoot
try {
    & $Python -c "import struct, sys; sys.exit(0 if sys.platform == 'win32' and sys.version_info >= (3, 10) and struct.calcsize('P') == 8 else 'Build requires Windows and 64-bit Python 3.10 or newer.')"
    if ($LASTEXITCODE -ne 0) { throw 'Unsupported Python build environment.' }
    if (-not $SkipInstall) {
        & $Python -m pip install -r (Join-Path $projectRoot 'requirements-dev.txt')
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    }
    $version = (& $Python -c 'from studytime import __version__; print(__version__)').Trim()
    if ($LASTEXITCODE -ne 0 -or $version -notmatch '^\d+\.\d+\.\d+(?:[-.][A-Za-z0-9.]+)?$') {
        throw 'Invalid package version.'
    }
    $distRoot = Assert-ProjectOutput (Join-Path $projectRoot 'dist')
    $distribution = Assert-ProjectOutput (Join-Path $distRoot 'StudyTimeTracker')
    $buildRoot = Assert-ProjectOutput (Join-Path $projectRoot 'build')
    $workPath = Assert-ProjectOutput (Join-Path $buildRoot 'pyinstaller')
    $assetRoot = Assert-ProjectOutput (Join-Path $buildRoot ('assets-' + [Guid]::NewGuid().ToString('N')))
    $webAssets = Join-Path $assetRoot 'web'
    $extensionAssets = Join-Path $assetRoot 'extension'
    $null = New-Item -ItemType Directory -Path $webAssets, $extensionAssets -Force
    foreach ($name in @('index.html', 'app.js', 'charts.js', 'style.css')) {
        Copy-Item -LiteralPath (Join-Path $projectRoot ('web\' + $name)) -Destination $webAssets
    }
    foreach ($name in @('manifest.json', 'background.js', 'protocol.mjs', 'popup.html', 'popup.css', 'popup.js', 'README.md')) {
        Copy-Item -LiteralPath (Join-Path $projectRoot ('extension\' + $name)) -Destination $extensionAssets
    }
    # --noconfirm replaces only the validated project-owned distribution path.
    # No application settings, browser profiles, or local databases are inputs.
    $arguments = @(
        '-m', 'PyInstaller', '--noconfirm', '--windowed', '--onedir',
        '--name', 'StudyTimeTracker',
        '--icon', (Join-Path $projectRoot 'assets\app.ico'),
        '--distpath', $distRoot,
        '--workpath', $workPath,
        '--specpath', $buildRoot,
        '--add-data', ($webAssets + ';web'),
        '--add-data', ($extensionAssets + ';extension'),
        '--collect-all', 'webview',
        '--collect-all', 'pythonnet',
        '--hidden-import', 'pystray._win32',
        '--copy-metadata', 'pywebview',
        '--copy-metadata', 'pystray',
        '--copy-metadata', 'Pillow',
        '--copy-metadata', 'pythonnet',
        '--copy-metadata', 'clr_loader',
        (Join-Path $projectRoot 'main.py')
    )
    & $Python @arguments
    if ($LASTEXITCODE -ne 0) { throw 'PyInstaller build failed.' }
    if (-not (Test-Path -LiteralPath (Join-Path $distribution 'StudyTimeTracker.exe') -PathType Leaf)) {
        throw 'Build did not produce StudyTimeTracker.exe.'
    }
    foreach ($name in @('install.ps1', 'Install.cmd', 'README.md', 'LICENSE')) {
        Copy-Item -LiteralPath (Join-Path $projectRoot $name) -Destination $distribution -Force
    }
    $archive = Assert-ProjectOutput (Join-Path $distRoot ("StudyTimeTracker-$version-windows-x64.zip"))
    Compress-Archive -Path (Join-Path $distribution '*') -DestinationPath $archive -Force
    Write-Host "Built: $distribution"
    Write-Host "ZIP:   $archive"
}
finally {
    Pop-Location
}
