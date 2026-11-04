[CmdletBinding()]
param(
    [switch]$NoLaunch,
    [switch]$ValidateOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Assert-NoLinks {
    param([Parameter(Mandatory)][string]$Root)
    if (-not (Test-Path -LiteralPath $Root)) { return }
    $pending = New-Object 'System.Collections.Generic.Stack[string]'
    $pending.Push($Root)
    while ($pending.Count -gt 0) {
        $current = Get-Item -LiteralPath $pending.Pop() -Force
        if ($current.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw "Refusing to copy through a symbolic link or junction: $($current.FullName)"
        }
        if ($current.PSIsContainer) {
            foreach ($child in Get-ChildItem -LiteralPath $current.FullName -Force) {
                $pending.Push($child.FullName)
            }
        }
    }
}

if (-not [Environment]::Is64BitOperatingSystem -or ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64' -and $env:PROCESSOR_ARCHITEW6432 -ne 'AMD64')) {
    throw 'This package requires Windows 10/11 x64.'
}
$sourceRoot = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $PSScriptRoot).ProviderPath)
$localData = [IO.Path]::GetFullPath([Environment]::GetFolderPath('LocalApplicationData'))
$programsRoot = [IO.Path]::GetFullPath((Join-Path $localData 'Programs'))
$installRoot = [IO.Path]::GetFullPath((Join-Path $programsRoot 'StudyTimeTracker'))
$expectedRoot = $programsRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar + 'StudyTimeTracker'
if (-not $installRoot.Equals($expectedRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Unexpected installation target: $installRoot"
}
if (-not $sourceRoot.Equals($installRoot, [StringComparison]::OrdinalIgnoreCase)) {
    $separator = [IO.Path]::DirectorySeparatorChar
    if ($sourceRoot.StartsWith($installRoot + $separator, [StringComparison]::OrdinalIgnoreCase) -or $installRoot.StartsWith($sourceRoot + $separator, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'The source package and installation folder must not contain each other. Extract the ZIP to a separate folder first.'
    }
}
# Validate existing ancestors as well as the entire destination before copying.
foreach ($ancestor in @($localData, $programsRoot)) {
    if (Test-Path -LiteralPath $ancestor) {
        $item = Get-Item -LiteralPath $ancestor -Force
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw "Refusing to install through a linked directory: $ancestor"
        }
    }
}
$payload = @('StudyTimeTracker.exe', '_internal', 'README.md', 'LICENSE', 'install.ps1', 'Install.cmd')
foreach ($name in $payload) {
    $source = Join-Path $sourceRoot $name
    if (-not (Test-Path -LiteralPath $source)) { throw "Incomplete package: $name is missing. Fully extract the release ZIP first." }
    Assert-NoLinks $source
}
if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot 'StudyTimeTracker.exe') -PathType Leaf)) { throw 'The program executable is missing.' }
if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot '_internal') -PathType Container)) { throw 'The runtime folder is missing.' }
Assert-NoLinks $installRoot
$executable = Join-Path $installRoot 'StudyTimeTracker.exe'
$desktop = [Environment]::GetFolderPath('DesktopDirectory')
$appTitle = '学习时长统计系统'
$shortcutPath = Join-Path $desktop ($appTitle + '.lnk')
$startupCommand = '"' + $executable + '" --background'

if ($ValidateOnly) {
    Write-Host "Validated source: $sourceRoot"
    Write-Host "Install target:   $installRoot"
    Write-Host "Desktop shortcut: $shortcutPath"
    Write-Host "Startup command:  $startupCommand"
    Write-Host 'Validation only; no files or settings were changed.'
    return
}

if (Get-Process -Name 'StudyTimeTracker' -ErrorAction SilentlyContinue) {
    throw 'StudyTimeTracker is running. Choose Exit from its system tray menu, then run this installer again.'
}
if (-not $sourceRoot.Equals($installRoot, [StringComparison]::OrdinalIgnoreCase)) {
    $null = New-Item -ItemType Directory -Path $installRoot -Force
    foreach ($name in $payload) {
        Copy-Item -LiteralPath (Join-Path $sourceRoot $name) -Destination $installRoot -Recurse -Force
    }
} else {
    Write-Host 'Already running the installer from the installation folder; skipping self-copy.'
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $executable
$shortcut.WorkingDirectory = $installRoot
$shortcut.Description = $appTitle
$shortcut.IconLocation = $executable + ',0'
$shortcut.Save()
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
if (-not (Test-Path -LiteralPath $runKey)) { $null = New-Item -Path $runKey -Force }
$null = New-ItemProperty -Path $runKey -Name 'StudyTimeTracker' -Value $startupCommand -PropertyType String -Force
Write-Host "Installed: $installRoot"
Write-Host 'Desktop shortcut created. Automatic startup after Windows sign-in is enabled.'
Write-Host 'Learning records remain in the separate LocalAppData\StudyTimeTracker folder.'
if (-not $NoLaunch) {
    Start-Process -FilePath $executable -WorkingDirectory $installRoot -WindowStyle Hidden
}
