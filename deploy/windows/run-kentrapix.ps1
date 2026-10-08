# KentraPix en production sur ce PC : relance le serveur s'il s'arrete.
# Lance automatiquement a l'ouverture de session (tache planifiee "KentraPix").
$server = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) "server"
$logs = Join-Path $server "logs"
New-Item -ItemType Directory -Force $logs | Out-Null
Set-Location $server
while ($true) {
  $log = Join-Path $logs ("kentrapix-{0:yyyy-MM-dd}.log" -f (Get-Date))
  cmd.exe /c "echo [%date% %time%] demarrage >> `"$log`" & node src/server.js >> `"$log`" 2>&1"
  Get-ChildItem $logs -Filter *.log | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-14) } | Remove-Item -Force
  Start-Sleep -Seconds 5
}
