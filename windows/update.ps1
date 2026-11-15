# Chat Studio: автообновление на Windows. Запускается планировщиком каждые 5 минут (задача ChatStudio-Update)
# или вручную:  powershell -ExecutionPolicy Bypass -File C:\ChatStudio\update.ps1 [-Force]
param([switch]$Force)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogFile = Join-Path $Root 'logs\update.log'
New-Item -ItemType Directory -Force -Path (Join-Path $Root 'logs') | Out-Null
function Log($m) {
  $line = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m
  Add-Content -Path $LogFile -Value $line -Encoding UTF8
  Write-Host $line
}
if ((Test-Path $LogFile) -and ((Get-Item $LogFile).Length -gt 2MB)) { Move-Item $LogFile "$LogFile.old" -Force }

# настройки: PORT и (необязательно) UPDATE_REPO из settings.env
$Port = '8420'; $Repo = 'ddimavo/chat-editor'
$envFile = Join-Path $Root 'settings.env'
if (Test-Path $envFile) {
  foreach ($l in Get-Content $envFile) {
    if ($l -match '^\s*PORT\s*=\s*(\d+)') { $Port = $Matches[1] }
    if ($l -match '^\s*UPDATE_REPO\s*=\s*(\S+)') { $Repo = $Matches[1] }
  }
}
$Base = "https://github.com/$Repo/releases/download/windows-latest"

# не запускать две проверки одновременно
$mutex = New-Object System.Threading.Mutex($false, 'Global\ChatStudioUpdate')
if (-not $mutex.WaitOne(0)) { exit 0 }

function Stop-App {
  Stop-ScheduledTask -TaskName 'ChatStudio' -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($Root, [StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
}
function Wait-Healthy {
  for ($i = 0; $i -lt 30; $i++) {
    try { $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/healthz" -UseBasicParsing -TimeoutSec 3; if ($r.StatusCode -eq 200) { return $true } } catch { }
    Start-Sleep -Seconds 2
  }
  return $false
}

try {
  $wc = New-Object System.Net.WebClient
  $wc.Encoding = [System.Text.Encoding]::UTF8
  try { $remote = $wc.DownloadString("$Base/version.txt").Trim() } catch { Log "не удалось проверить обновления (нет сети или релиза): $($_.Exception.Message)"; exit 0 }
  $verFile = Join-Path $Root 'version.txt'; $badFile = Join-Path $Root 'bad-version.txt'
  $local = ''; if (Test-Path $verFile) { $local = (Get-Content $verFile -Raw).Trim() }
  if (-not $Force) {
    if ($remote -eq $local) { exit 0 }
    if ((Test-Path $badFile) -and ((Get-Content $badFile -Raw).Trim() -eq $remote)) { exit 0 }
  }
  Log "новая версия: $remote (сейчас: $(if ($local) { $local } else { 'нет' })). Скачиваю…"

  $tmpZip = Join-Path $Root 'download.zip'; $next = Join-Path $Root 'next'
  if (Test-Path $tmpZip) { Remove-Item $tmpZip -Force }
  if (Test-Path $next) { Remove-Item $next -Recurse -Force }
  $wc.DownloadFile("$Base/chat-studio-windows.zip", $tmpZip)
  Expand-Archive -Path $tmpZip -DestinationPath $next -Force
  Remove-Item $tmpZip -Force
  if (-not ((Test-Path (Join-Path $next 'node.exe')) -and (Test-Path (Join-Path $next 'server\src\index.js')))) { throw 'в архиве нет node.exe или server\src\index.js' }

  Stop-App
  $cur = Join-Path $Root 'current'; $prev = Join-Path $Root 'previous'
  if (Test-Path $prev) { Remove-Item $prev -Recurse -Force }
  if (Test-Path $cur) { Move-Item $cur $prev }
  Move-Item $next $cur
  # свежие служебные файлы из пакета (update.ps1 подменяется со следующего запуска)
  $win = Join-Path $cur 'windows'
  if (Test-Path $win) {
    foreach ($f in 'run.cmd', 'cli.cmd', 'update.cmd') { if (Test-Path (Join-Path $win $f)) { Copy-Item (Join-Path $win $f) $Root -Force } }
    if (Test-Path (Join-Path $win 'update.ps1')) { Copy-Item (Join-Path $win 'update.ps1') (Join-Path $Root 'update.ps1.new') -Force }
  }

  Start-ScheduledTask -TaskName 'ChatStudio'
  if (Wait-Healthy) {
    Set-Content -Path $verFile -Value $remote -Encoding ASCII
    if (Test-Path $badFile) { Remove-Item $badFile -Force }
    Log "готово: версия $remote работает"
  } else {
    Log 'ОШИБКА: новая версия не запустилась, откатываюсь'
    Set-Content -Path $badFile -Value $remote -Encoding ASCII
    Stop-App
    if (Test-Path $prev) {
      Remove-Item $cur -Recurse -Force
      Move-Item $prev $cur
      Start-ScheduledTask -TaskName 'ChatStudio'
      if (Wait-Healthy) { Log 'откат выполнен, прежняя версия работает' } else { Log 'ВНИМАНИЕ: после отката приложение не отвечает, проверьте logs\app.log' }
    }
  }
} catch {
  Log "ОШИБКА обновления: $($_.Exception.Message)"
} finally {
  $mutex.ReleaseMutex() | Out-Null
}
