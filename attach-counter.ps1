param([Parameter(Mandatory = $true)][string]$Version, [string]$JarPath)
# Attaches the newest Counter jar (or the given one, e.g. a port for another Minecraft version) to an existing
# launcher release (launchers download it on their own) and puts it into bundled\ for the next installer.
# Needs $env:GH_TOKEN.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$owner = 'HckrJT'; $repo = 'counter-launcher'
$jar = if ($JarPath) { Get-Item $JarPath } else { Get-ChildItem ..\Taptup\build\libs\counter-client-*.jar | Where-Object { $_.Name -notmatch 'sources' } | Sort-Object LastWriteTime | Select-Object -Last 1 }
if (-not $jar) { throw 'no Counter jar' }
# ports are only downloaded, the installer keeps the main jar
if (-not $JarPath) {
  Get-ChildItem bundled\counter-client-*.jar -ErrorAction SilentlyContinue | Remove-Item
  Copy-Item $jar.FullName bundled\
}
$headers = @{ Authorization = "Bearer $env:GH_TOKEN"; 'User-Agent' = 'counter-release'; Accept = 'application/vnd.github+json' }
$release = Invoke-RestMethod -Headers $headers "https://api.github.com/repos/$owner/$repo/releases/tags/v$Version"
$upload = $release.upload_url -replace '\{.*\}', ''
Invoke-RestMethod -Method Post -Headers $headers -ContentType 'application/java-archive' -InFile $jar.FullName "$upload`?name=$($jar.Name)" | Out-Null
Write-Host "Attached $($jar.Name) to v$Version"
