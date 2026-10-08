# ==========================================================================
# KentraPix - deploiement depuis Windows vers le serveur (Oracle Cloud, Hetzner...)
#
#   powershell -ExecutionPolicy Bypass -File deploy\deploy.ps1 -Ip 152.67.x.x
#
# - envoie le code (sans node_modules, photos, ni .env)
# - envoie les cles e-mail Resend lues dans server\.env
# - lance deploy/setup-server.sh sur le serveur (installation ou mise a jour)
# Le token Cloudflare Tunnel est lu dans deploy\tunnel-token.txt (jamais dans Git).
# ==========================================================================
param(
  [Parameter(Mandatory = $true)][string]$Ip,
  [string]$Key = "",
  [string]$User = "ubuntu",
  [string]$Domain = "kentrapix.kenleyelysee.com"
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

# Cle SSH : celle donnee, sinon la premiere .key de ~/.ssh
if (-not $Key) {
  $found = Get-ChildItem "$env:USERPROFILE\.ssh" -Filter *.key -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $found) { throw "Aucune cle .key dans $env:USERPROFILE\.ssh : copiez-y la cle privee telechargee chez Oracle." }
  $Key = $found.FullName
}
# OpenSSH refuse une cle lisible par d'autres comptes Windows.
icacls $Key /inheritance:r /grant:r "$($env:USERNAME):(R)" | Out-Null
$ssh = @("-i", $Key, "-o", "StrictHostKeyChecking=accept-new", "-o", "ServerAliveInterval=30")
$target = "$User@$Ip"

Write-Host "==> Connexion a $target" -ForegroundColor Cyan
& ssh @ssh $target "echo ok" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Connexion SSH impossible. Verifiez l'IP, la cle et que le port 22 est ouvert." }

Write-Host "==> Preparation du code" -ForegroundColor Cyan
$tmp = Join-Path $env:TEMP "kentrapix-deploy"
New-Item -ItemType Directory -Force $tmp | Out-Null
$archive = Join-Path $tmp "kentrapix.tgz"
if (Test-Path $archive) { Remove-Item $archive -Force }
tar.exe -czf $archive `
  --exclude=./.git --exclude=./server/node_modules --exclude=./server/storage --exclude=./server/.env `
  --exclude=./_ancien-css --exclude=./backend --exclude=./database `
  --exclude=./deploy/tunnel-token.txt --exclude=./.claude `
  -C $root .
if ($LASTEXITCODE -ne 0) { throw "Creation de l'archive impossible." }
"{0:N1} Mo" -f ((Get-Item $archive).Length / 1MB) | Write-Host

# Cles e-mail (Resend) : seulement ces 3 lignes de server\.env
$secrets = Join-Path $tmp "kentrapix-secrets.env"
$envFile = Join-Path $root "server\.env"
$lines = @()
if (Test-Path $envFile) {
  $lines = Get-Content $envFile | Where-Object { $_ -match '^(RESEND_API_KEY|MAIL_FROM|MAIL_REPLY_TO)=' }
}
[IO.File]::WriteAllText($secrets, (($lines -join "`n") + "`n"))

$tokenFile = Join-Path $PSScriptRoot "tunnel-token.txt"
$hasToken = Test-Path $tokenFile
if (-not $hasToken) { Write-Host "(Pas de deploy\tunnel-token.txt : le tunnel Cloudflare ne sera pas installe cette fois.)" -ForegroundColor Yellow }

Write-Host "==> Envoi vers le serveur" -ForegroundColor Cyan
$files = @($archive, $secrets, (Join-Path $PSScriptRoot "setup-server.sh"))
if ($hasToken) { $files += $tokenFile }
& scp @ssh @files "${target}:/tmp/"
if ($LASTEXITCODE -ne 0) { throw "Envoi impossible." }

Write-Host "==> Installation sur le serveur" -ForegroundColor Cyan
$remote = @"
set -e
sudo mkdir -p /opt/kentrapix
sudo rm -rf /opt/kentrapix/app.new && sudo mkdir -p /opt/kentrapix/app.new
sudo tar -xzf /tmp/kentrapix.tgz -C /opt/kentrapix/app.new
sudo rm -rf /opt/kentrapix/app.old
if [ -d /opt/kentrapix/app ]; then sudo mv /opt/kentrapix/app /opt/kentrapix/app.old; fi
sudo mv /opt/kentrapix/app.new /opt/kentrapix/app
sed -i 's/\r$//' /tmp/setup-server.sh
TOKEN=""; if [ -f /tmp/tunnel-token.txt ]; then TOKEN="`$(tr -d '\r\n ' < /tmp/tunnel-token.txt)"; rm -f /tmp/tunnel-token.txt; fi
sudo APP_DOMAIN='$Domain' TUNNEL_TOKEN="`$TOKEN" SECRETS_FILE=/tmp/kentrapix-secrets.env bash /tmp/setup-server.sh
rm -f /tmp/kentrapix.tgz /tmp/setup-server.sh
"@
& ssh @ssh $target ($remote -replace "`r", "")
$code = $LASTEXITCODE
Remove-Item $secrets -Force -ErrorAction SilentlyContinue
if ($code -ne 0) { throw "L'installation a echoue (code $code). Journal : ssh $target sudo journalctl -u kentrapix -n 50" }
Write-Host "==> Termine : https://$Domain" -ForegroundColor Green
