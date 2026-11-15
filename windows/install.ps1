# Chat Studio: установка на Windows Server (2016/2019/2022) БЕЗ Docker и без установки Node.js — всё нужное лежит в архиве.
# Запуск (PowerShell от имени администратора):
#   Invoke-WebRequest https://raw.githubusercontent.com/ddimavo/chat-editor/main/windows/install.ps1 -OutFile install.ps1 -UseBasicParsing
#   powershell -ExecutionPolicy Bypass -File .\install.ps1 -Port 8420
param(
  [string]$Root = 'C:\ChatStudio',
  [int]$Port = 8420,
  [string]$Repo = 'ddimavo/chat-editor'
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host 'Запустите PowerShell от имени администратора.' -ForegroundColor Red; exit 1
}
$Base = "https://github.com/$Repo/releases/download/windows-latest"
New-Item -ItemType Directory -Force -Path $Root, (Join-Path $Root 'data'), (Join-Path $Root 'logs') | Out-Null

Write-Host 'Останавливаю прежнюю копию (если была)…'
Stop-ScheduledTask -TaskName 'ChatStudio' -ErrorAction SilentlyContinue
Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($Root, [StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force -ErrorAction SilentlyContinue

Write-Host 'Скачиваю приложение…'
$zip = Join-Path $Root 'download.zip'; $cur = Join-Path $Root 'current'
$wc = New-Object System.Net.WebClient
try { $wc.DownloadFile("$Base/chat-studio-windows.zip", $zip) }
catch {
  Write-Host "Не удалось скачать $Base/chat-studio-windows.zip" -ForegroundColor Red
  Write-Host 'Проверьте, что в GitHub (вкладка Actions) завершилась сборка «Build Windows package» и есть релиз windows-latest.' -ForegroundColor Yellow
  exit 1
}
if (Test-Path $cur) { Remove-Item $cur -Recurse -Force }
Expand-Archive -Path $zip -DestinationPath $cur -Force
Remove-Item $zip -Force
foreach ($f in 'run.cmd', 'cli.cmd', 'update.cmd', 'update.ps1') { Copy-Item (Join-Path $cur "windows\$f") $Root -Force }
Copy-Item (Join-Path $cur 'version.txt') (Join-Path $Root 'version.txt') -Force

$envFile = Join-Path $Root 'settings.env'
if (-not (Test-Path $envFile)) {
  @(
    '# Настройки Chat Studio. Формат: ИМЯ=значение (без пробелов вокруг "="; пустые значения не пишите — просто удалите строку).',
    '# После изменения перезапустите:  Stop-ScheduledTask ChatStudio; Start-ScheduledTask ChatStudio',
    "PORT=$Port",
    '# REGISTRATION=closed          # закрыть регистрацию (пользователей создавать через cli.cmd)',
    '# REGISTRATION_CODE=секрет     # код приглашения для регистрации',
    '# TRUST_PROXY=1                # если перед приложением стоит IIS/Caddy/nginx',
    '# COOKIE_SECURE=true           # при работе через HTTPS',
    '# USER_QUOTA_MB=1024',
    '# MAX_IMAGE_MB=40'
  ) | Set-Content -Path $envFile -Encoding UTF8
} elseif (-not (Select-String -Path $envFile -Pattern '^\s*PORT\s*=' -Quiet)) {
  Add-Content -Path $envFile -Value "PORT=$Port" -Encoding UTF8
}
# порт берём из settings.env (при повторной установке он уже мог быть изменён вручную)
$m = Select-String -Path $envFile -Pattern '^\s*PORT\s*=\s*(\d+)' | Select-Object -First 1
if ($m) { $Port = [int]$m.Matches[0].Groups[1].Value }

Write-Host "Открываю порт $Port в брандмауэре…"
if (-not (Get-NetFirewallRule -DisplayName 'Chat Studio' -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName 'Chat Studio' -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow | Out-Null
} else { Set-NetFirewallRule -DisplayName 'Chat Studio' -LocalPort $Port }

Write-Host 'Регистрирую задачи планировщика…'
$sys = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$runAct = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$Root\run.cmd`"" -WorkingDirectory $Root
$runSet = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'ChatStudio' -Action $runAct -Trigger (New-ScheduledTaskTrigger -AtStartup) -Principal $sys -Settings $runSet -Description 'Chat Studio (сервер приложения)' -Force | Out-Null

$updAct = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$Root\update.cmd`"" -WorkingDirectory $Root
$updTrig = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)
$updSet = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -StartWhenAvailable -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'ChatStudio-Update' -Action $updAct -Trigger $updTrig -Principal $sys -Settings $updSet -Description 'Chat Studio: проверка и установка новой версии' -Force | Out-Null

Write-Host 'Запускаю…'
Start-ScheduledTask -TaskName 'ChatStudio'
$ok = $false
for ($i = 0; $i -lt 30; $i++) {
  try { if ((Invoke-WebRequest -Uri "http://127.0.0.1:$Port/healthz" -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200) { $ok = $true; break } } catch { }
  Start-Sleep -Seconds 2
}
if ($ok) {
  $ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' } | Select-Object -First 1).IPAddress
  Write-Host ''
  Write-Host "Готово! Приложение работает: http://${ip}:$Port  (с самого сервера: http://localhost:$Port)" -ForegroundColor Green
  Write-Host "Автообновление включено (проверка раз в 5 минут). Журналы: $Root\logs. Администрирование: $Root\cli.cmd users"
} else {
  Write-Host "Приложение не ответило за минуту. Смотрите $Root\logs\app.log" -ForegroundColor Red
  exit 1
}
