<# Run ONLY inside a new disposable Windows Sandbox/VM. Installs and uninstalls
   the actual setup EXE in that guest; never a host-profile test substitute. #>
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$OutputDirectory,
  [switch]$DisposableGuest
)
$ErrorActionPreference = 'Stop'
$guestComputer = Get-CimInstance Win32_ComputerSystem
$guestPattern = 'Virtual Machine|VMware|VirtualBox|KVM|QEMU|Parallels|HVM domU|Xen'
$isSandbox = $env:USERNAME -eq 'WDAGUtilityAccount' -and $guestComputer.Model -match $guestPattern
$isConfirmedVM = $DisposableGuest -and $guestComputer.Model -match $guestPattern
if (-not ($isSandbox -or $isConfirmedVM)) {
  throw 'REFUSED: installer lifecycle requires Windows Sandbox or an explicitly confirmed disposable Windows VM. Physical-host accounts are excluded.'
}
if (Get-Process Azkript -ErrorAction SilentlyContinue) { throw 'Guest is not clean: Azkript is already running.' }
$uninstallRoots = @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')
function Get-AzkriptInstall {
  foreach ($registryRoot in $uninstallRoots) {
    Get-ChildItem -LiteralPath $registryRoot -ErrorAction SilentlyContinue | Get-ItemProperty | Where-Object DisplayName -eq 'Azkript'
  }
}
if (Get-AzkriptInstall) { throw 'Guest is not clean: an existing Azkript installation was found.' }
if (Test-Path -LiteralPath (Join-Path $env:APPDATA 'Azkript')) { throw 'Guest is not clean: an existing Azkript profile was found.' }
$sourceRoot = Split-Path -Parent $PSScriptRoot
$guestRoot = Join-Path $env:TEMP ('azkript-package-guest-' + [guid]::NewGuid().ToString('N'))
$guestInstall = Join-Path $guestRoot 'installed path with spaces\Azkript'
$guestWork = Join-Path $guestRoot 'work'
$guestReport = [ordered]@{ startedAt = (Get-Date).ToUniversalTime().ToString('o'); isolation = 'Disposable Windows guest'; operatingSystemIsolation = $true; account = [Security.Principal.WindowsIdentity]::GetCurrent().Name; sessionId = [Diagnostics.Process]::GetCurrentProcess().SessionId; computer = $guestComputer | Select-Object Manufacturer,Model; actualInstallerExecuted = $false; passed = $false; checks = @() }
New-Item -ItemType Directory -Path $guestWork,$OutputDirectory -Force | Out-Null
Copy-Item -Path (Join-Path $sourceRoot '*') -Destination $guestWork -Recurse -Force
$guestNode = Join-Path $guestWork 'runtime\node.exe'
$manifest = Get-Content -LiteralPath (Join-Path $guestWork 'package-test-manifest.json') -Raw | ConvertFrom-Json
$guestReport['artifacts'] = $manifest.artifacts
$guestReport['sameVersionReinstall'] = $false
$guestReport['missingDefaultsPreserved'] = $false
function Assert-Guest($condition, [string]$message) { if (-not $condition) { throw $message }; $script:guestReport.checks += $message }
function Invoke-Hidden([string]$executable, [string[]]$arguments, [int]$timeoutSeconds = 120) {
  # NSIS /D= and _?= must be the final unquoted argument; both parsers consume
  # the remaining command line as the path, including its embedded spaces.
  $process = Start-Process -FilePath $executable -ArgumentList $arguments -WindowStyle Hidden -PassThru
  if (-not $process.WaitForExit($timeoutSeconds * 1000)) {
    & "$env:SystemRoot\System32\taskkill.exe" /PID $process.Id /T /F | Out-Null
    throw ('Guest test process timed out; owned tree stopped: ' + $executable)
  }
  if ($process.ExitCode -ne 0) { throw ('Guest process failed with exit ' + $process.ExitCode + ': ' + $executable) }
}
try {
  foreach ($artifact in $manifest.artifacts) {
    $guestArtifact = Join-Path $guestWork $artifact.file
    Assert-Guest ((Get-FileHash -LiteralPath $guestArtifact -Algorithm SHA256).Hash.ToLowerInvariant() -eq $artifact.sha256) ('Verified input SHA256: ' + $artifact.file)
  }
  Push-Location $guestWork
  try {
    & $guestNode 'scripts/test-portable-launcher.cjs' *> 'reports/portable-launcher.log'
    Assert-Guest ($LASTEXITCODE -eq 0) 'Actual portable wrapper passed full desktop smoke'
    $guestPreviousDefaults = @{ '.fdx' = 'Azkript.Test.ExistingFdx'; '.fdxt' = 'Azkript.Test.ExistingFdxt' }
    foreach ($extension in $guestPreviousDefaults.Keys) {
      $extensionKey = 'HKCU:\Software\Classes\' + $extension
      New-Item -Path $extensionKey -Force | Out-Null
      Set-Item -LiteralPath $extensionKey -Value $guestPreviousDefaults[$extension]
      $previousCommandKey = 'HKCU:\Software\Classes\' + $guestPreviousDefaults[$extension] + '\shell\open\command'
      New-Item -Path $previousCommandKey -Force | Out-Null
      Set-Item -LiteralPath $previousCommandKey -Value ('"' + $env:WINDIR + '\System32\notepad.exe" "%1"')
    }
    $setup = Join-Path $guestWork $manifest.installer
    $guestReport.actualInstallerExecuted = $true
    Invoke-Hidden $setup @('/S','/currentuser',('/D=' + $guestInstall))
    $installedApp = Join-Path $guestInstall 'Azkript.exe'
    Assert-Guest (Test-Path -LiteralPath $installedApp) 'Installer created executable at requested directory'
    Assert-Guest ((Get-FileHash -LiteralPath $installedApp -Algorithm SHA256).Hash.ToLowerInvariant() -eq $manifest.installedExecutableSHA256) 'Installed executable matches verified distribution payload'
    Assert-Guest ((Get-FileHash -LiteralPath (Join-Path $guestInstall 'resources\app.asar') -Algorithm SHA256).Hash.ToLowerInvariant() -eq $manifest.appAsarSHA256) 'Installed application archive matches verified distribution payload'
    $registered = @(Get-AzkriptInstall)
    Assert-Guest ($registered.Count -eq 1) 'Exactly one Azkript uninstall registration exists'
    Assert-Guest ($registered[0].UninstallString.Contains($guestInstall)) 'Uninstall registry points to guest installation'
    Assert-Guest (Test-Path -LiteralPath (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Azkript.lnk')) 'Desktop shortcut exists'
    Assert-Guest (Test-Path -LiteralPath (Join-Path ([Environment]::GetFolderPath('Programs')) 'Azkript.lnk')) 'Start Menu shortcut exists'
    foreach ($extension in $guestPreviousDefaults.Keys) {
      $extensionKey = Get-Item -LiteralPath ('HKCU:\Software\Classes\' + $extension)
      Assert-Guest ($extensionKey.GetValue('') -eq $guestPreviousDefaults[$extension]) ('Installer preserved previous default: ' + $extension)
      $openWithKey = Get-Item -LiteralPath ('HKCU:\Software\Classes\' + $extension + '\OpenWithProgids')
      Assert-Guest ($openWithKey.GetValueNames() -contains 'Azkript Screenplay') ('Installer registered Open With: ' + $extension)
    }
    $openCommandKey = Get-Item -LiteralPath 'HKCU:\Software\Classes\Azkript Screenplay\shell\open\command'
    Assert-Guest ($openCommandKey.GetValue('') -eq ('"' + $installedApp + '" "%1"')) 'Open command quotes both executable and document paths'
    Assert-Guest (-not (Get-Process Azkript -ErrorAction SilentlyContinue)) 'Silent setup did not launch app automatically'
    $env:AZKRIPT_TEST_EXECUTABLE = $installedApp
    & $guestNode 'desktop/tests/electron-smoke.cjs' *> 'reports/installed-app.log'
    Assert-Guest ($LASTEXITCODE -eq 0) 'Installed app passed full desktop smoke'
    & $guestNode 'desktop/tests/accessibility-electron.cjs' *> 'reports/installed-accessibility.log'
    Assert-Guest ($LASTEXITCODE -eq 0) 'Installed app passed native accessibility backend and composition regressions'
    & $guestNode 'desktop/tests/background-isolation-electron.cjs' *> 'reports/installed-background-guards.log'
    Assert-Guest ($LASTEXITCODE -eq 0) 'Installed app passed background native-dialog and crash-recovery guards'
    $profileMarkerDirectory = Join-Path $env:APPDATA 'Azkript'
    New-Item -ItemType Directory -Path $profileMarkerDirectory -Force | Out-Null
    $profileMarker = Join-Path $profileMarkerDirectory 'uninstall-preservation-test.txt'
    Set-Content -LiteralPath $profileMarker -Value 'Guest-only private data must survive uninstall.'
    Invoke-Hidden (Join-Path $guestInstall 'Uninstall Azkript.exe') @('/S','/currentuser',('_?=' + $guestInstall))
    Assert-Guest (-not (Test-Path -LiteralPath $installedApp)) 'Uninstaller removed installed executable'
    Assert-Guest (-not (Get-AzkriptInstall)) 'Uninstaller removed product registration'
    foreach ($extension in $guestPreviousDefaults.Keys) {
      $extensionKey = Get-Item -LiteralPath ('HKCU:\Software\Classes\' + $extension)
      Assert-Guest ($extensionKey.GetValue('') -eq $guestPreviousDefaults[$extension]) ('Uninstaller preserved previous default: ' + $extension)
      $openWithKey = Get-Item -LiteralPath ('HKCU:\Software\Classes\' + $extension + '\OpenWithProgids') -ErrorAction SilentlyContinue
      Assert-Guest (-not $openWithKey -or $openWithKey.GetValueNames() -notcontains 'Azkript Screenplay') ('Uninstaller removed Open With: ' + $extension)
    }
    Assert-Guest (-not (Test-Path -LiteralPath 'HKCU:\Software\Classes\Azkript Screenplay')) 'Uninstaller removed product file class'
    Assert-Guest (-not (Test-Path -LiteralPath (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Azkript.lnk'))) 'Uninstaller removed desktop shortcut'
    Assert-Guest (-not (Test-Path -LiteralPath (Join-Path ([Environment]::GetFolderPath('Programs')) 'Azkript.lnk'))) 'Uninstaller removed Start Menu shortcut'
    Assert-Guest (Test-Path -LiteralPath $profileMarker) 'Uninstaller preserved private user data'
    Invoke-Hidden $setup @('/S','/currentuser',('/D=' + $guestInstall))
    Assert-Guest (Test-Path -LiteralPath $installedApp) 'Reinstall restored executable'
    Assert-Guest ((Get-FileHash -LiteralPath $installedApp -Algorithm SHA256).Hash.ToLowerInvariant() -eq $manifest.installedExecutableSHA256) 'Reinstalled executable matches verified payload'
    Assert-Guest (Test-Path -LiteralPath $profileMarker) 'Reinstall preserved existing profile data'
    foreach ($extension in $guestPreviousDefaults.Keys) {
      Assert-Guest ((Get-Item -LiteralPath ('HKCU:\Software\Classes\' + $extension)).GetValue('') -eq $guestPreviousDefaults[$extension]) ('Reinstall preserved previous default: ' + $extension)
    }
    & $guestNode 'desktop/tests/electron-smoke.cjs' *> 'reports/reinstalled-app.log'
    Assert-Guest ($LASTEXITCODE -eq 0) 'Reinstalled app passed full desktop smoke'
    Invoke-Hidden (Join-Path $guestInstall 'Uninstall Azkript.exe') @('/S','/currentuser',('_?=' + $guestInstall))
    Assert-Guest (-not (Test-Path -LiteralPath $installedApp)) 'Second uninstall removed executable'
    Assert-Guest (-not (Get-AzkriptInstall)) 'Second uninstall removed product registration'
    Assert-Guest (Test-Path -LiteralPath $profileMarker) 'Second uninstall preserved profile data'
    $guestReport.sameVersionReinstall = $true
    foreach ($extension in $guestPreviousDefaults.Keys) {
      $guestExtensionKey = Get-Item -LiteralPath ('HKCU:\Software\Classes\' + $extension)
      Assert-Guest ($guestExtensionKey.GetValue('') -eq $guestPreviousDefaults[$extension]) ('Only the guest fixture default is cleared: ' + $extension)
      $guestExtensionKey.DeleteValue('', $false)
    }
    Invoke-Hidden $setup @('/S','/currentuser',('/D=' + $guestInstall))
    foreach ($extension in $guestPreviousDefaults.Keys) {
      Assert-Guest ($null -eq (Get-Item -LiteralPath ('HKCU:\Software\Classes\' + $extension)).GetValue('', $null)) ('Installer preserved missing default: ' + $extension)
    }
    Invoke-Hidden (Join-Path $guestInstall 'Uninstall Azkript.exe') @('/S','/currentuser',('_?=' + $guestInstall))
    foreach ($extension in $guestPreviousDefaults.Keys) {
      $guestExtensionKey = Get-Item -LiteralPath ('HKCU:\Software\Classes\' + $extension) -ErrorAction SilentlyContinue
      Assert-Guest (-not $guestExtensionKey -or $null -eq $guestExtensionKey.GetValue('', $null)) ('Uninstaller preserved missing default: ' + $extension)
    }
    Assert-Guest (-not (Test-Path -LiteralPath $installedApp)) 'Missing-default scenario removed executable'
    Assert-Guest (-not (Get-AzkriptInstall)) 'Missing-default scenario removed product registration'
    $guestReport.missingDefaultsPreserved = $true
    $guestReport.passed = $true
  } finally { Pop-Location }
} catch { $guestReport.error = $_.Exception.ToString(); throw }
finally {
  $guestReport.finishedAt = (Get-Date).ToUniversalTime().ToString('o')
  $guestReport | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $OutputDirectory 'package-lifecycle.json') -Encoding UTF8
  foreach ($resultFile in @('portable-launcher.log','portable-launcher-verification.json','installed-app.log','reinstalled-app.log','installed-accessibility.log','native-accessibility.json','installed-background-guards.log')) {
    Copy-Item -LiteralPath (Join-Path $guestWork ('reports\' + $resultFile)) -Destination $OutputDirectory -Force -ErrorAction SilentlyContinue
  }
}
