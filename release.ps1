# Publishes a new Counter Launcher version (and the newest Counter mod jar) as a GitHub release.
# Every installed launcher finds it on its next start and updates itself.
#
#   $env:GH_TOKEN = "<token with the 'repo' scope>"   # only in this PowerShell window, never commit it
#   .\release.ps1 1.0.1
param([Parameter(Mandatory = $true)][string]$Version)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not $env:GH_TOKEN) { throw 'Set $env:GH_TOKEN first (GitHub token with the repo scope).' }
$pkg = Get-Content package.json -Raw | ConvertFrom-Json
$owner = $pkg.build.publish[0].owner
$repo = $pkg.build.publish[0].repo
if ($owner -like 'DEIN_*') { throw 'Enter your GitHub name as "owner" under build.publish in package.json first.' }

# 1. version number
npm version $Version --no-git-tag-version --allow-same-version | Out-Null

# 2. newest Counter jar from the mod project goes into the installer
$jar = Get-ChildItem ..\Taptup\build\libs\counter-client-*.jar | Sort-Object LastWriteTime | Select-Object -Last 1
if ($jar) {
  Get-ChildItem bundled\counter-client-*.jar -ErrorAction SilentlyContinue | Remove-Item
  Copy-Item $jar.FullName bundled\
  Write-Host "Counter jar: $($jar.Name)"
}

# 3. build + upload installer and latest.yml (electron-builder creates the release v$Version)
$env:ELECTRON_BUILDER_CACHE = "$env:USERPROFILE\gtmp\eb-cache"
npx electron-builder --win nsis --publish always
if ($LASTEXITCODE -ne 0) { throw 'electron-builder failed' }

# 4. attach the Counter jar to the same release, so launchers can update the mod on their own
if ($jar) {
  $headers = @{ Authorization = "Bearer $env:GH_TOKEN"; 'User-Agent' = 'counter-release'; Accept = 'application/vnd.github+json' }
  $release = Invoke-RestMethod -Headers $headers "https://api.github.com/repos/$owner/$repo/releases/tags/v$Version"
  $upload = $release.upload_url -replace '\{.*\}', ''
  Invoke-RestMethod -Method Post -Headers $headers -ContentType 'application/java-archive' -InFile $jar.FullName "$upload`?name=$($jar.Name)" | Out-Null
  Write-Host "Attached $($jar.Name)"
}
Write-Host "Released Counter Launcher $Version"
