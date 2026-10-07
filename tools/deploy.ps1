# tools/deploy.ps1 — init/commit/push LABIRINTO to GitHub and enable Pages.
# Uses the token stored in Git Credential Manager; never prints secrets.
param(
  [string]$RepoName = 'labirinto',
  [string]$CommitMessage = 'LABIRINTO: deploy'
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

Set-Location -Path (Split-Path -Parent $PSScriptRoot)

# ---- git init / commit (idempotent) ----
if (-not (Test-Path .git)) { git init -b main | Out-Null }
git add -A | Out-Null
$changed = (git status --short | Measure-Object).Count
if ($changed -gt 0) {
  git commit -m $CommitMessage 2>&1 | Out-Null
  Write-Host "committed $changed path(s)"
} else {
  Write-Host 'no changes to commit'
}

# ---- stored GitHub credentials (direct GCM exec; `git credential fill`
# routes through sh.exe which spawns signal pipes the sandbox may deny) ----
$helper = 'C:\Program Files\Git\mingw64\bin\git-credential-manager.exe'
if (-not (Test-Path $helper)) { throw 'git-credential-manager.exe not found' }
$credLines = ("protocol=https`nhost=github.com`n`n" | & $helper get 2>$null | Out-String)
$username = (($credLines -split '`n' | Select-String '^username=').Line -replace '^username=', '').Trim()
$password = (($credLines -split '`n' | Select-String '^password=').Line -replace '^password=', '').Trim()
if (-not $password) { throw 'no stored GitHub credential; run "gh auth login" or push manually once' }
Write-Host "git credential: stored (user: $username, token hidden)"
$basic = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("${username}:${password}"))

# ---- curl-based API helper (raw status codes, no TLS surprises) ----
$tmpDir = Join-Path $PSScriptRoot '.deploy-tmp'
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null

function Api {
  param($method, $endpoint, $bodyObj, $authHead)
  $outFile = Join-Path $tmpDir 'api-out.txt'
  $reqFile = Join-Path $tmpDir 'api-req.json'
  $a = @('-sS', '-o', $outFile, '-w', '%{http_code}', '-X', $method,
         '-H', "Authorization: $authHead",
         '-H', 'Accept: application/vnd.github+json',
         '-H', 'User-Agent: labirinto-deploy')
  if ($bodyObj) {
    ($bodyObj | ConvertTo-Json) | Out-File -FilePath $reqFile -Encoding ascii
    $a += @('-H', 'Content-Type: application/json', '--data', "@$reqFile")
  }
  $a += $endpoint
  $code = (& curl.exe @a)
  $body = ''
  if (Test-Path $outFile) { $body = (Get-Content $outFile -Raw -ErrorAction SilentlyContinue) }
  return @{ code = [string]$code; body = $body }
}

# ---- authenticated user (Bearer first, then Basic fallback) ----
$authHead = "Bearer $password"
$me = Api 'GET' 'https://api.github.com/user' $null $authHead
if ($me.code -ne '200') {
  Write-Host "bearer auth rejected (HTTP $($me.code)); trying basic ..."
  $authHead = "Basic $basic"
  $me = Api 'GET' 'https://api.github.com/user' $null $authHead
}
if ($me.code -ne '200') { throw "github auth failed (HTTP $($me.code)): $($me.body)" }
$login = ($me.body | ConvertFrom-Json).login
Write-Host "github account: $login"

# ---- create repo (or reuse) ----
$desc = 'LABIRINTO: find the key, escape the maze (browser maze-escape PWA)'
$cr = Api 'POST' 'https://api.github.com/user/repos' (@{ name = $RepoName; description = $desc; private = $false }) $authHead
if ($cr.code -eq '201') { Write-Host "repo created: $login/$RepoName" }
elseif ($cr.code -eq '422') { Write-Host 'repo already exists — reusing' }
else { throw "repo create failed (HTTP $($cr.code)): $($cr.body)" }

# ---- push (auth header embedded; credential helper disabled: its sh.exe
# wrapper spawns signal pipes which the sandbox denies) ----
if (-not (git remote | Select-String '^origin$')) {
  git remote add origin "https://github.com/$login/$RepoName.git"
}
$pushOut = git -c credential.helper= -c "http.extraheader=AUTHORIZATION: basic $basic" push -u origin HEAD 2>&1 | Out-String
if ($LASTEXITCODE -ne 0) { throw "push failed: $pushOut" }
Write-Host 'pushed to origin'

# ---- enable GitHub Pages (main / site root) ----
try {
  $pg = Api 'POST' "https://api.github.com/repos/$login/$RepoName/pages" (@{ build_type = 'legacy'; source = @{ branch = 'main'; path = '/' } }) $authHead
  if ($pg.code -eq '201') { Write-Host 'pages: enabled' }
  elseif ($pg.code -eq '409') { Write-Host 'pages: already enabled' }
  else { Write-Host "pages: HTTP $($pg.code) $($pg.body)" }
} catch { Write-Host "pages: request issue :: $_" }

# ---- wait until the site answers ----
$site = "https://$login.github.io/$RepoName/"
Write-Host "waiting for $site ..."
$live = $false
$deadline = (Get-Date).AddSeconds(240)
while ((Get-Date) -lt $deadline) {
  $c = & curl.exe -sS -o NUL -w '%{http_code}' -A 'labirinto-deploy' $site
  if ($c -eq '200') { $live = $true; break }
  Start-Sleep -Seconds 8
}
if ($live) { Write-Host "LIVE: $site" }
else { Write-Host 'WARNING: pages not answering yet (first build can lag a few minutes); check shortly' }

Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue
Write-Host "done. site: $site"