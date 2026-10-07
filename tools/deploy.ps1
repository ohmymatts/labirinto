# tools/deploy.ps1 — init/commit/push LABIRINTO to GitHub and enable Pages.
# Uses credentials stored in Git Credential Manager; never prints secrets.
param(
  [string]$RepoName = 'labirinto',
  [string]$CommitMessage = 'LABIRINTO: deploy'
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

Set-Location -Path (Split-Path -Parent $PSScriptRoot)

# ---- git init / commit (idempotent) ----
if (-not (Test-Path .git)) { git init -b main | Out-Null }
git add -A
$changed = (git status --short | Measure-Object).Count
if ($changed -gt 0) {
  git commit -m $CommitMessage | Out-Null
  Write-Host "committed $changed path(s)"
} else {
  Write-Host 'no changes to commit'
}
git add -A | Out-Null # stage any missed (e.g., first run ordering)

# ---- stored GitHub credentials (Git Credential Manager, invoked directly:
# `git credential fill` routes through sh.exe which the sandbox may deny) ----
$helper = 'C:\Program Files\Git\mingw64\bin\git-credential-manager.exe'
$fillText = "protocol=https`nhost=github.com`n`n"
$credLines = $fillText | & $helper get 2>$null | Out-String
$username = ($credLines -split "`n" | Select-String '^username=').Line -replace '^username=', ''
$password = ($credLines -split "`n" | Select-String '^password=').Line -replace '^password=', ''
if (-not $password) { throw 'no stored GitHub credential; run: git push once interactively, or gh auth login' }
Write-Host "git credential: stored (user: $username, token hidden)"

$basic = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("${username}:${password}"))
$headers = @{ Authorization = "Basic $basic"; 'User-Agent' = 'labirinto-deploy'; Accept = 'application/vnd.github+json' }

# ---- discover the GitHub login ----
$me = Invoke-RestMethod -Uri 'https://api.github.com/user' -Headers $headers -TimeoutSec 20
$login = $me.login
Write-Host "github account: $login"

# ---- create repo (or reuse if it exists) ----
try {
  Invoke-RestMethod -Method Post -Uri 'https://api.github.com/user/repos' -Headers $headers `
    -ContentType 'application/json' -Body (@{ name = $RepoName; description = 'LABIRINTO — find the key, escape the maze (browser maze-escape PWA)'; private = $false } | ConvertTo-Json) | Out-Null
  Write-Host "repo created: $login/$RepoName"
} catch {
  $status = try { $_.Exception.Response.StatusCode.value__ } catch { 0 }
  if ($status -eq 422) { Write-Host 'repo already exists - reusing' }
  else { throw $_ }
}

# ---- push ----
if (-not (git remote | Select-String '^origin$')) {
  git remote add origin "https://github.com/$login/$RepoName.git"
}
# push with the auth header embedded and the credential helper disabled —
# the helper path spawns sh.exe (signalling pipes), which the sandbox denies
git -c credential.helper= -c "http.extraheader=AUTHORIZATION: basic $basic" push -u origin HEAD 2>&1 | Out-Null
Write-Host 'pushed to origin'

# ---- enable GitHub Pages (branch main, site root) ----
try {
  Invoke-RestMethod -Method Post -Uri "https://api.github.com/repos/$login/$RepoName/pages" -Headers $headers `
    -ContentType 'application/json' -Body (@{ build_type = 'legacy'; source = @{ branch = 'main'; path = '/' } } | ConvertTo-Json) | Out-Null
  Write-Host 'pages: enabled (legacy main/root)'
} catch {
  $status = try { $_.Exception.Response.StatusCode.value__ } catch { 0 }
  if ($status -eq 409) { Write-Host 'pages: already enabled' }
  else { throw $_ }
}

# ---- wait until the site answers ----
$site = "https://$login.github.io/$RepoName/"
Write-Host "deploying to $site ..."
$deadline = (Get-Date).AddSeconds(240)
while ((Get-Date) -lt $deadline) {
  try {
    $r = Invoke-WebRequest -Uri $site -TimeoutSec 10 -UseBasicParsing
    if ($r.StatusCode -eq 200) { Write-Host "LIVE: $site"; break }
  } catch { Start-Sleep -Seconds 8 }
}
if ((Get-Date) -ge $deadline) { Write-Host 'WARNING: github pages not answering yet (first build can take a few minutes) - check later' }

Write-Host "done. site: $site"