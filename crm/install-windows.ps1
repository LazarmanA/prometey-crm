$ErrorActionPreference='Stop'
Set-Location $PSScriptRoot
try {
  $nodeDir=Join-Path $PSScriptRoot 'runtime\node'
  $nodeExe=Join-Path $nodeDir 'node.exe'
  if (!(Test-Path $nodeExe)) {
    Write-Host 'Скачиваю официальный Node.js 24 для Windows x64...'
    [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
    $base='https://nodejs.org/dist/latest-v24.x/'
    $checks=(Invoke-WebRequest -UseBasicParsing ($base+'SHASUMS256.txt')).Content
    $line=($checks -split "`n" | Where-Object {$_ -match '^([0-9a-f]{64})\s+(node-v24[^\s]*-win-x64\.zip)\s*$'} | Select-Object -First 1)
    if (!$line) {throw 'Не удалось найти официальную сборку Node.js 24 для Windows x64'}
    $line -match '^([0-9a-f]{64})\s+(\S+)' | Out-Null
    $expected=$Matches[1]; $filename=$Matches[2]
    $zip=Join-Path $env:TEMP $filename
    Invoke-WebRequest -UseBasicParsing ($base+$filename) -OutFile $zip
    $actual=(Get-FileHash -Algorithm SHA256 $zip).Hash.ToLowerInvariant()
    if ($actual -ne $expected) {throw 'Контрольная сумма Node.js не совпала; установка остановлена'}
    $temp=Join-Path $env:TEMP ('prometey-node-'+[guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $temp -Force | Out-Null
    Expand-Archive -LiteralPath $zip -DestinationPath $temp -Force
    New-Item -ItemType Directory -Path $nodeDir -Force | Out-Null
    $extracted=Get-ChildItem $temp -Directory | Select-Object -First 1
    Copy-Item (Join-Path $extracted.FullName '*') $nodeDir -Recurse -Force
    Remove-Item $temp -Recurse -Force
    Remove-Item $zip -Force
  }
  $ver=& $nodeExe --version
  Write-Host "Node.js $ver"
  $env:PATH="$nodeDir;$env:PATH"
  Write-Host 'Проверяю исходный код...'
  & $nodeExe --check (Join-Path $PSScriptRoot 'server.js')
  if ($LASTEXITCODE -ne 0) {throw 'Проверка server.js не пройдена'}
  Write-Host 'Запускаю CRM только на этом сервере: http://127.0.0.1:3030'
  Write-Host 'Для публикации в интернет сначала настройте HTTPS, права доступа и резервные копии.'
  Start-Process 'http://127.0.0.1:3030'
  & $nodeExe (Join-Path $PSScriptRoot 'server.js')
  if ($LASTEXITCODE -ne 0) {throw "CRM завершилась с кодом $LASTEXITCODE"}
} catch {
  Write-Host ('ОШИБКА: '+$_.Exception.Message) -ForegroundColor Red
  exit 1
}
