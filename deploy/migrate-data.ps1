# ==========================================================================
# KentraPix - copie de la base MySQL et des photos du PC vers le serveur.
# A lancer UNE fois, apres deploy.ps1. ATTENTION : remplace la base et les photos du serveur.
#
#   powershell -ExecutionPolicy Bypass -File deploy\migrate-data.ps1 -Ip 152.67.x.x
# ==========================================================================
param(
  [Parameter(Mandatory = $true)][string]$Ip,
  [string]$Key = "",
  [string]$User = "ubuntu",
  [string]$MysqlDump = "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqldump.exe"
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

if (-not $Key) {
  $found = Get-ChildItem "$env:USERPROFILE\.ssh" -Filter *.key -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $found) { throw "Aucune cle .key dans $env:USERPROFILE\.ssh" }
  $Key = $found.FullName
}
$ssh = @("-i", $Key, "-o", "StrictHostKeyChecking=accept-new", "-o", "ServerAliveInterval=30")
$target = "$User@$Ip"

# Parametres MySQL locaux lus dans server\.env
$cfg = @{}
Get-Content (Join-Path $root "server\.env") | Where-Object { $_ -match '^[A-Z_]+=' } | ForEach-Object {
  $k, $v = $_ -split '=', 2; $cfg[$k] = $v
}
$tmp = Join-Path $env:TEMP "kentrapix-deploy"
New-Item -ItemType Directory -Force $tmp | Out-Null
$dump = Join-Path $tmp "kentrapix.sql"
$photos = Join-Path $tmp "storage.tgz"

Write-Host "==> Export de la base locale ($($cfg.DB_HOST):$($cfg.DB_PORT))" -ForegroundColor Cyan
$env:MYSQL_PWD = $cfg.DB_PASSWORD
& $MysqlDump --host=$($cfg.DB_HOST) --port=$($cfg.DB_PORT) --user=$($cfg.DB_USER) `
  --single-transaction --routines --no-tablespaces --default-character-set=utf8mb4 `
  --result-file=$dump $cfg.DB_NAME
$code = $LASTEXITCODE
Remove-Item Env:\MYSQL_PWD
if ($code -ne 0) { throw "Export MySQL impossible." }
"{0:N1} Mo" -f ((Get-Item $dump).Length / 1MB) | Write-Host

Write-Host "==> Archive des photos (server\storage)" -ForegroundColor Cyan
tar.exe -czf $photos --exclude=./tmp --exclude=./watermarks -C (Join-Path $root "server\storage") .
if ($LASTEXITCODE -ne 0) { throw "Archive des photos impossible." }
"{0:N1} Mo" -f ((Get-Item $photos).Length / 1MB) | Write-Host

Write-Host "==> Envoi (peut etre long selon votre connexion)" -ForegroundColor Cyan
& scp @ssh $dump $photos "${target}:/tmp/"
if ($LASTEXITCODE -ne 0) { throw "Envoi impossible." }

Write-Host "==> Import sur le serveur" -ForegroundColor Cyan
$remote = @"
set -e
sudo systemctl stop kentrapix
sudo mysql kentrapix < /tmp/kentrapix.sql
sudo mkdir -p /opt/kentrapix/storage
sudo tar -xzf /tmp/storage.tgz -C /opt/kentrapix/storage
sudo mkdir -p /opt/kentrapix/storage/tmp /opt/kentrapix/storage/watermarks
sudo chown -R kentrapix:kentrapix /opt/kentrapix/storage
cd /opt/kentrapix/app/server && sudo -u kentrapix node scripts/db-init.js | tail -n 1
sudo systemctl start kentrapix
rm -f /tmp/kentrapix.sql /tmp/storage.tgz
sleep 3; curl -fsS http://127.0.0.1:3000/api/health && echo " KentraPix OK"
"@
& ssh @ssh $target ($remote -replace "`r", "")
$code = $LASTEXITCODE
Remove-Item $dump, $photos -Force -ErrorAction SilentlyContinue
if ($code -ne 0) { throw "Import echoue (code $code)." }
Write-Host "==> Donnees copiees. Reconnectez-vous sur le site (nouvelle cle de session)." -ForegroundColor Green
