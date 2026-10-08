# Cloudflare Tunnel : https://kentrapix.kenleyelysee.com -> ce PC (port 3000).
# Configuration : %USERPROFILE%\.cloudflared\config.yml. Tache planifiee "KentraPix Tunnel".
# cloudflared est copie dans %LOCALAPPDATA%\KentraPix : l'antivirus 360 bloque celui de Program Files.
$cf = Join-Path $env:LOCALAPPDATA "KentraPix\cloudflared.exe"
if (-not (Test-Path $cf)) { $cf = "C:\Program Files (x86)\cloudflared\cloudflared.exe" }
$logs = Join-Path (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) "server") "logs"
New-Item -ItemType Directory -Force $logs | Out-Null
while ($true) {
  $log = Join-Path $logs ("tunnel-{0:yyyy-MM-dd}.log" -f (Get-Date))
  cmd.exe /c "`"$cf`" tunnel --no-autoupdate run kentrapix >> `"$log`" 2>&1"
  Start-Sleep -Seconds 10
}
