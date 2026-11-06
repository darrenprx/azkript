# Refresh the Windows shell icon cache so Explorer and the taskbar re-read an
# app's icon from its executable.
#
# WHY THIS EXISTS
#   Windows caches the icon it extracted for a given file path. When a packaged
#   exe is rebuilt in place (same path, new icon resource), the shell can keep
#   serving the OLD extracted image - so a correct build still *looks* like it
#   "didn't use this icon". The embedded bytes are fine; the cache is stale.
#
#   `python scripts/probe-exe-icon.py` distinguishes the two cases. If it reports
#   "SHELL MISMATCH", the bytes are current and the cache is the problem -> run
#   this script. If it reports "FAIL ... does not carry the current icon.ico",
#   the artifact itself is stale -> rebuild with `npm run package:dir` instead.
#
# WHAT IT DOES
#   1. Shell-visible refresh (always, cheap, no elevation):
#        SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, NULL, NULL)
#      This makes the shell drop its cached associations/icon lookups and
#      re-query. It fixes the common "explorer still shows the old icon" case
#      without restarting anything.
#   2. Byte-level refresh (opt-in, -RebuildIconCache):
#      Restart Explorer, which is the only supported way to make it release its
#      iconcache_*.db files so they can be deleted and rebuilt.
#
#   `ie4uinit.exe -show` is NOT run by default. On Windows 10/11 it re-runs the
#   shell icon-cache rebuild and is a common cargo-culted fix, but it is a
#   per-user, side-effecting tool that *overwrites* the shared cache database;
#   running it unnecessarily throws away a healthy cache. It is exposed behind
#   -UseIe4uinit for the case where the per-user cache really is corrupt, and its
#   effect is documented rather than assumed.
#
# SAFETY
#   Idempotent: re-running it is harmless. Nothing outside the per-user icon
#   cache is touched, nothing is installed, no registry state is created, and
#   -WhatIf shows the plan without changing anything.
#
# USAGE
#   pwsh scripts/refresh-icon-cache.ps1                 # notify the shell only
#   pwsh scripts/refresh-icon-cache.ps1 -Verify         # notify, then re-probe
#   pwsh scripts/refresh-icon-cache.ps1 -RebuildIconCache
#   pwsh scripts/refresh-icon-cache.ps1 -RebuildIconCache -UseIe4uinit
#   pwsh scripts/refresh-icon-cache.ps1 -WhatIf         # print the plan only

[CmdletBinding(SupportsShouldProcess = $true)]
param(
    # Restart Explorer and delete/recreate the per-user iconcache_*.db files.
    # This is the only way to force the shell to re-extract a changed icon.
    [switch]$RebuildIconCache,

    # Additionally run `ie4uinit.exe -show`, the older shell cache reset.
    # Off by default: it is redundant with -RebuildIconCache on Windows 10/11.
    [switch]$UseIe4uinit,

    # Run scripts/probe-exe-icon.py afterwards and surface its verdict.
    [switch]$Verify,

    # Only act if the probe proves the shell is returning the wrong image.
    [switch]$OnlyIfProbeReportsMismatch
)

$ErrorActionPreference = 'Stop'
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptRoot
$probe = Join-Path $scriptRoot 'probe-exe-icon.py'

# --- 1. shell-level refresh: SHChangeNotify(SHCNE_ASSOCCHANGED) -------------
# This is a cheap, per-user notification. It needs no elevation and creates no
# persistent state; the shell simply discards its association cache.
function Invoke-ShellAssocChanged {
    if (-not ('AzkriptIconCacheNotify' -as [type])) {
        Add-Type -Namespace '' -Name 'AzkriptIconCacheNotify' -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("shell32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
public static extern void SHChangeNotify(int wEventId, uint uFlags, System.IntPtr dwItem1, System.IntPtr dwItem2);
'@
    }
    # SHCNE_ASSOCCHANGED = 0x08000000, SHCNF_IDLIST = 0x0000
    [AzkriptIconCacheNotify]::SHChangeNotify(0x08000000, 0x0000, [IntPtr]::Zero, [IntPtr]::Zero)
}

# --- 2. optional: evidence-gate the destructive path ------------------------
function Get-ProbeVerdict {
    param([switch]$NoShell)
    if (-not (Test-Path -LiteralPath $probe)) { return $null }
    $arguments = @($probe)
    if ($NoShell) { $arguments += '--no-shell' }
    $output = & python @arguments 2>&1
    return [pscustomobject]@{
        ExitCode = $LASTEXITCODE
        Text     = ($output -join "`n")
    }
}

# --- 3. byte-level refresh: restart Explorer, rebuild the cache -------------
function Reset-IconCacheDatabase {
    $cacheDir = Join-Path $env:LOCALAPPDATA 'Microsoft\Windows\Explorer'
    if (-not (Test-Path -LiteralPath $cacheDir)) {
        Write-Warning "icon cache directory not found: $cacheDir"
        return
    }

    # Explorer holds these files open; it must be stopped first or the delete
    # silently fails and the stale entries survive.
    $explorer = Get-Process -Name explorer -ErrorAction SilentlyContinue
    if ($explorer) {
        if ($PSCmdlet.ShouldProcess('explorer.exe', 'Restart (to release icon cache files)')) {
            Write-Host '  stopping explorer.exe...'
            $explorer | ForEach-Object { $_.CloseMainWindow() | Out-Null }
            Start-Sleep -Milliseconds 400
            Get-Process -Name explorer -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
            Start-Sleep -Milliseconds 600
        }
    }

    $files = Get-ChildItem -LiteralPath $cacheDir -Filter 'iconcache_*.db' -Force -ErrorAction SilentlyContinue
    if ($files) {
        foreach ($file in $files) {
            if ($PSCmdlet.ShouldProcess($file.FullName, 'Delete icon cache database')) {
                try {
                    Remove-Item -LiteralPath $file.FullName -Force -ErrorAction Stop
                    Write-Host "  removed $($file.Name)"
                }
                catch {
                    Write-Warning "could not remove $($file.Name): $($_.Exception.Message)"
                }
            }
        }
    }

    # Explorer rebuilds the cache (and its own db files) as soon as it restarts.
    if (-not (Get-Process -Name explorer -ErrorAction SilentlyContinue)) {
        if ($PSCmdlet.ShouldProcess('explorer.exe', 'Start')) {
            Write-Host '  starting explorer.exe...'
            Start-Process -FilePath (Join-Path $env:SystemRoot 'explorer.exe') | Out-Null
            Start-Sleep -Milliseconds 800
        }
    }
}

function Invoke-Ie4uinit {
    $ie4uinit = Join-Path $env:SystemRoot 'System32\ie4uinit.exe'
    if (-not (Test-Path -LiteralPath $ie4uinit)) {
        Write-Warning "ie4uinit.exe not found at $ie4uinit (skipping)"
        return
    }
    if ($PSCmdlet.ShouldProcess('ie4uinit.exe -show', 'Rebuild the shell icon cache')) {
        # -show is the Windows 10/11 flag that triggers the cache rebuild.
        & $ie4uinit -show
        Write-Host '  ran ie4uinit.exe -show'
    }
}

# --- main ------------------------------------------------------------------
Write-Host 'Icon cache refresh'
Write-Host "  repo: $repoRoot"

$probeResult = $null
if ($Verify -or $OnlyIfProbeReportsMismatch) {
    if ($OnlyIfProbeReportsMismatch) {
        Write-Host '  checking whether the shell really is serving a stale image...'
        $probeResult = Get-ProbeVerdict -NoShell
        # With -NoShell we only know about the embedded bytes. A byte-level pass
        # plus a visible stale icon is exactly the cache case, so:
        if ($null -ne $probeResult -and $probeResult.ExitCode -eq 0) {
            Write-Host '  probe says the artifacts embed the current icon -> cache is the likely cause'
        }
        elseif ($null -ne $probeResult) {
            Write-Warning 'the probe reports stale BYTES, not a stale cache. Rebuild first:'
            Write-Warning '  npm run package:dir && npm run package:portable && npm run package:win'
            if (-not $RebuildIconCache) {
                Write-Host ''
                Write-Host 'Not touching the icon cache; the build is the problem, not the cache.'
                exit 1
            }
        }
    }
}

if ($PSCmdlet.ShouldProcess('shell', 'Broadcast SHCNE_ASSOCCHANGED')) {
    Invoke-ShellAssocChanged
    Write-Host '  broadcast SHCNE_ASSOCCHANGED (shell will re-query icons)'
    # The shell rebuilds its icon entries asynchronously. Querying it in the same
    # instant can return a half-built image for that path, which looks exactly like
    # a stale icon. Give the rebuild a moment before anything re-reads the cache.
    if ($Verify) {
        Start-Sleep -Milliseconds 1200
    }
}

if ($RebuildIconCache) {
    Reset-IconCacheDatabase
    if ($UseIe4uinit) { Invoke-Ie4uinit }
}
elseif ($UseIe4uinit) {
    # Asking for ie4uinit alone still implies a cache rebuild.
    Invoke-Ie4uinit
}

if ($Verify) {
    Write-Host ''
    Write-Host 'Re-probing the packaged artifacts...'
    $verdict = Get-ProbeVerdict
    if ($null -eq $verdict) {
        Write-Warning "probe not found at $probe"
    }
    else {
        Write-Host $verdict.Text
        if ($verdict.ExitCode -eq 0) {
            Write-Host ''
            Write-Host 'PASS - the shell now returns the icon embedded in the exe.'
        }
        else {
            Write-Warning 'the probe still fails; see its output above.'
            exit 1
        }
    }
}

Write-Host ''
Write-Host 'Done. If Explorer still shows the old image, close and reopen the folder,'
Write-Host 'or run with -RebuildIconCache to force a full per-user cache rebuild.'
