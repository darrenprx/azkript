param([Parameter(Mandatory=$true)][string]$CertificateThumbprint, [string]$TimestampServer = 'http://timestamp.digicert.com')
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -Force
$taskRoot = Split-Path $PSScriptRoot -Parent
$taskPackage = Get-Content -LiteralPath (Join-Path $taskRoot 'package.json') -Raw | ConvertFrom-Json
$taskArtifacts = @("Azkript-$($taskPackage.version)-portable.exe", "Azkript-Setup-$($taskPackage.version).exe")
if ($CertificateThumbprint -notmatch '^[a-fA-F0-9]{40}$') { throw 'Supply a certificate thumbprint, never private key material.' }
$taskSignTool = Get-Command signtool.exe -ErrorAction Stop
# Let electron-builder sign the inner executable before producing both wrappers.
& node (Join-Path $PSScriptRoot 'build-writing-worker.cjs')
if ($LASTEXITCODE -ne 0) { throw 'Worker generation failed.' }
& node (Join-Path $taskRoot 'node_modules/electron-builder/out/cli/cli.js') --win --x64 --publish never --config.win.signExecutable=true --config.forceCodeSigning=true "--config.win.signtoolOptions.certificateSha1=$CertificateThumbprint" "--config.win.signtoolOptions.rfc3161TimeStampServer=$TimestampServer"
if ($LASTEXITCODE -ne 0) { throw 'Signed build failed.' }
$taskInner = Join-Path $taskRoot 'dist/win-unpacked/Azkript.exe'
$taskInnerSignature = Get-AuthenticodeSignature -LiteralPath $taskInner
if ($taskInnerSignature.Status -ne 'Valid' -or $taskInnerSignature.SignerCertificate.Thumbprint -ne $CertificateThumbprint) { throw 'Inner application signature verification failed.' }
foreach ($taskArtifact in $taskArtifacts) {
  $taskFile = Join-Path $taskRoot "dist/$taskArtifact"
  $taskSignature = Get-AuthenticodeSignature -LiteralPath $taskFile
  if ($taskSignature.Status -ne 'Valid' -or $taskSignature.SignerCertificate.Thumbprint -ne $CertificateThumbprint) { throw "Signature verification failed: $taskArtifact" }
}
& node (Join-Path $PSScriptRoot 'verify-release.cjs')
if ($LASTEXITCODE -ne 0) { throw 'Signed release verification failed.' }
& node (Join-Path $PSScriptRoot 'verify-dist-payloads.cjs')
if ($LASTEXITCODE -ne 0) { throw 'Signed wrapper payload verification failed.' }
& node (Join-Path $PSScriptRoot 'release-manifest.cjs')
if ($LASTEXITCODE -ne 0) { throw 'Release manifest generation failed.' }
