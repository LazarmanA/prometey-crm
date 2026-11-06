# =====================================================================
#  ПРОМЕТЕЙ CRM — отправка программы на сервер (запускается из deploy.bat)
#  Первый раз — устанавливает, следующие разы — обновляет (данные сохраняются).
# =====================================================================
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

function Ok($t)   { Write-Host "OK  $t" -ForegroundColor Green }
function Info($t) { Write-Host ">>  $t" -ForegroundColor Cyan }
function Fail($t) { Write-Host "ОШИБКА: $t" -ForegroundColor Red; Read-Host "Нажмите Enter, чтобы закрыть"; exit 1 }

Write-Host ""
Write-Host "=== ПРОМЕТЕЙ CRM: размещение на сервере ===" -ForegroundColor Magenta
Write-Host ""

# --- нужные программы Windows ---
foreach ($cmd in 'ssh','scp','tar') {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    Fail "В Windows нет программы '$cmd'. Откройте: Параметры -> Приложения -> Дополнительные компоненты -> Добавить компонент -> 'Клиент OpenSSH'. Затем запустите снова."
  }
}

# --- папка проекта ---
$here = $PSScriptRoot
if     (Test-Path (Join-Path $here '..\package.json')) { $proj = (Resolve-Path (Join-Path $here '..')).Path }
elseif (Test-Path (Join-Path $here 'package.json'))    { $proj = $here }
else {
  $proj = Read-Host "Вставьте путь к папке Прометея (где лежит package.json)"
  $proj = $proj.Trim('"')
  if (-not (Test-Path (Join-Path $proj 'package.json'))) { Fail "В папке '$proj' нет package.json." }
}
Ok "Папка проекта: $proj"

# --- адрес сервера: берём из server.txt, лишних вопросов не задаём ---
$cfg = Join-Path $here 'server.txt'
$ip = ''; $user = 'root'; $port = '22'
if (Test-Path $cfg) { $l = @(Get-Content $cfg); if ($l.Count -gt 0) { $ip = "$($l[0])".Trim() }; if ($l.Count -gt 1 -and "$($l[1])".Trim()) { $user = "$($l[1])".Trim() }; if ($l.Count -gt 2 -and "$($l[2])".Trim() -match '^\d{1,5}$') { $port = "$($l[2])".Trim() } }
# защита от случайно вписанного пароля: адрес — только цифры и точки (или домен), пользователь — латиница в нижнем регистре
if ($ip -notmatch '^(\d{1,3}\.){3}\d{1,3}$' -and $ip -notmatch '^[a-z0-9.-]+\.[a-z]{2,}$') { $ip = '' }
if ($user -cnotmatch '^(root|ubuntu|admin)$') { $user = 'root' }  # на серверах Рег.облака вход всегда root
if (-not $ip) {
  $ip = (Read-Host "Введите IP-адрес сервера (например 89.108.70.182)").Trim()
  if ($ip -notmatch '^(\d{1,3}\.){3}\d{1,3}$' -and $ip -notmatch '^[a-z0-9.-]+\.[a-z]{2,}$') { Fail "'$ip' — это не IP-адрес. IP выглядит так: 89.108.70.182" }
}
Set-Content -Path $cfg -Value @($ip, $user, $port) -Encoding ASCII
Ok "Сервер: $user@$ip (порт $port)"

$installer = Join-Path $here 'install-server.sh'
if (-not (Test-Path $installer)) { Fail "Рядом нет файла install-server.sh — положите его в ту же папку." }

# --- упаковка (без баз данных, чтобы не затереть рабочие данные на сервере) ---
Info "Упаковываю программу…"
$arch = Join-Path $env:TEMP 'prometey.tgz'
if (Test-Path $arch) { Remove-Item $arch -Force }
& tar -czf $arch --exclude=node_modules --exclude=.git --exclude=deploy --exclude=installer --exclude=runtime `
     --exclude=*.db --exclude=*.db-wal --exclude=*.db-shm --exclude=*.db-journal `
     --exclude=*.sqlite --exclude=*.sqlite3 --exclude=*.exe -C $proj .
if ($LASTEXITCODE -ne 0) { Fail "Не удалось упаковать папку." }
Ok ("Архив готов: {0:N1} МБ" -f ((Get-Item $arch).Length / 1MB))

$target = "$user@$ip"
$base = @('-o',"Port=$port",'-o','StrictHostKeyChecking=accept-new','-o','ServerAliveInterval=30','-o','ConnectTimeout=25')

# После переустановки системы у сервера новый «отпечаток» — старый забываем, иначе ssh откажется подключаться.
$old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
& ssh-keygen -R $ip 2>$null | Out-Null; & ssh-keygen -R "[$ip]:$port" 2>$null | Out-Null
$ErrorActionPreference = $old

# --- ждём, пока сервер ответит (после перезагрузки или переустановки — до 15 минут) ---
function Probe {
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { $out = (& ssh @base -o BatchMode=yes -o ConnectTimeout=20 -o PreferredAuthentications=none $target 'true' 2>&1 | Out-String) } finally { $ErrorActionPreference = $old }
  # «Permission denied» = сервер жив и спрашивает пароль; всё остальное — не отвечает
  return ($out -match 'Permission denied|publickey|password|keyboard-interactive' -or $LASTEXITCODE -eq 0)
}
Info "Проверяю, отвечает ли сервер…"
$alive = $false; $sw = [Diagnostics.Stopwatch]::StartNew(); $warned = $false
while ($sw.Elapsed.TotalMinutes -lt 15) {
  if (Probe) { $alive = $true; break }
  if (-not $warned) { Write-Host "Сервер пока не отвечает. Если вы только что перезагрузили или переустановили его — это нормально, жду до 15 минут." -ForegroundColor Yellow; $warned = $true }
  Write-Host ("   жду сервер… {0:N0} мин" -f $sw.Elapsed.TotalMinutes)
  Start-Sleep -Seconds 10
}
if (-not $alive) { Fail "Сервер $ip не отвечает уже 15 минут. Откройте панель Рег.облака: сервер должен быть «Активен». Если он «Активен», но не отвечает — в меню сервера выберите «Переустановить ОС» → Ubuntu 24.04, подождите 5 минут и запустите снова." }
Ok "Сервер отвечает"

# --- ключ доступа: пароль root вводится ОДИН раз, дальше вход по ключу ---
$sshDir = Join-Path $env:USERPROFILE '.ssh'
if (-not (Test-Path $sshDir)) { New-Item -ItemType Directory -Path $sshDir | Out-Null }
$key = Join-Path $sshDir 'prometey_ed25519'
if (-not (Test-Path $key)) { & ssh-keygen -q -t ed25519 -f $key -N '""' -C 'prometey-deploy' | Out-Null }
if (-not (Test-Path "$key.pub")) { Fail "Не удалось создать ключ доступа (ssh-keygen)." }
$sshOpts = $base + @('-i',$key,'-o','IdentitiesOnly=yes')

function Test-Key { $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'; try { & ssh @sshOpts -o BatchMode=yes $target 'true' 2>$null | Out-Null; return ($LASTEXITCODE -eq 0) } catch { return $false } finally { $ErrorActionPreference = $old } }

if (Test-Key) { Ok "Вход на сервер по ключу — пароль не нужен" }
else {
  Write-Host ""
  Write-Host "Сейчас появится строка  root@$ip's password:" -ForegroundColor Yellow
  Write-Host "Скопируйте пароль root (Ctrl+C), щёлкните ПРАВОЙ кнопкой мыши в этом окне и нажмите Enter." -ForegroundColor Yellow
  Write-Host "Символы пароля НЕ видны — это нормально. Пароль нужен только один раз." -ForegroundColor Yellow
  Write-Host ""
  $pub = (Get-Content "$key.pub" -Raw).Trim()
  $addKey = "umask 077; mkdir -p ~/.ssh; touch ~/.ssh/authorized_keys; grep -qxF '$pub' ~/.ssh/authorized_keys || echo '$pub' >> ~/.ssh/authorized_keys"
  $ok = $false
  for ($try = 1; $try -le 5 -and -not $ok; $try++) {
    & ssh @base -o PreferredAuthentications=password -o PubkeyAuthentication=no -o NumberOfPasswordPrompts=1 $target $addKey
    $code = $LASTEXITCODE
    if ($code -eq 0 -and (Test-Key)) { $ok = $true; break }
    if ($try -lt 5) { Write-Host ""; Info "Не получилось (неверный пароль или сервер не ответил). Ещё раз ($($try+1)/5) — снова вставьте пароль root."; Start-Sleep -Seconds 5 }
  }
  if (-not $ok) { Fail "Не удалось войти на сервер. 'Permission denied' — пароль root неверный: скопируйте его заново из письма или сбросьте в панели Рег.облака. 'timed out' — сервер перегружен: подождите 5 минут и запустите снова." }
  Ok "Доступ по ключу настроен — больше пароль не понадобится"
}

# --- новый сервер или обновление? ---
$oldEA = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
$installed = ((& ssh @sshOpts $target 'test -f /opt/prometey/package.json && echo YES || echo NO' 2>$null | Out-String).Trim() -eq 'YES')
$ErrorActionPreference = $oldEA
$files = @($arch, $installer)
$dataArg = ''
if ($installed) { Ok "На сервере уже есть ПРОМЕТЕЙ — обновляю программу, данные сервера сохраняются" }
else {
  # --- данные CRM с этого компьютера: на новый сервер переезжают сами ---
  $pc = Join-Path $env:LOCALAPPDATA 'Prometey'
  $pcDb = Join-Path $pc 'data\prometey.sqlite'; $pcNode = Join-Path $pc 'runtime\node.exe'
  if ((Test-Path $pcDb) -and (Test-Path $pcNode)) {
    Info "Беру данные CRM с этого компьютера (сотрудники, компании, сделки, лента, файлы)…"
    $dt = Join-Path $env:TEMP 'prometey-data'
    if (Test-Path $dt) { Remove-Item $dt -Recurse -Force }
    New-Item -ItemType Directory -Path $dt | Out-Null
    # безопасная копия базы на ходу (CRM можно не закрывать)
    $js = "const s=require('node:sqlite');const db=new s.DatabaseSync(process.argv[1],{readOnly:true});s.backup(db,process.argv[2]).then(()=>{db.close()},e=>{console.error(e.message);process.exit(1)})"
    & $pcNode --no-warnings -e $js $pcDb (Join-Path $dt 'prometey.sqlite')
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path (Join-Path $dt 'prometey.sqlite'))) { Fail "Не удалось скопировать базу CRM с компьютера." }
    foreach ($d in 'documents','recordings','uploads') { $src = Join-Path $pc "data\$d"; if (Test-Path $src) { Copy-Item $src (Join-Path $dt $d) -Recurse } }
    $dataArch = Join-Path $env:TEMP 'prometey-data.tgz'
    if (Test-Path $dataArch) { Remove-Item $dataArch -Force }
    & tar -czf $dataArch -C $dt .
    if ($LASTEXITCODE -ne 0) { Fail "Не удалось упаковать данные." }
    Remove-Item $dt -Recurse -Force
    $files += $dataArch; $dataArg = ' --data /root/prometey-data.tgz'
    Ok ("Данные готовы: {0:N1} МБ — на сервере все войдут прежними логинами и паролями" -f ((Get-Item $dataArch).Length / 1MB))
  } else { Info "CRM на этом компьютере не найдена — на сервере будет чистая база, руководитель зарегистрируется по ссылке" }
}

Info "Отправляю файлы на сервер (1/2)…"
$sent = $false
for ($try = 1; $try -le 5 -and -not $sent; $try++) {
  & scp @sshOpts @files "${target}:/root/"
  if ($LASTEXITCODE -eq 0) { $sent = $true } elseif ($try -lt 5) { Info "Сервер не ответил — повтор через 10 секунд ($($try+1)/5)…"; Start-Sleep -Seconds 10 }
}
if (-not $sent) { Fail "Не удалось отправить файлы: сервер не отвечает. Подождите 5 минут и запустите снова." }
Ok "Файлы на сервере"

# --- установка идёт на сервере сама: даже если связь оборвётся, она не прервётся ---
Info "Запускаю установку на сервере (2/2). Это займёт 10–20 минут — окно можно не трогать…"
$start = "rm -f /root/prometey-install.exit /root/prometey-link.txt; sed -i 's/\r`$//' /root/install-server.sh; nohup setsid bash -c 'bash /root/install-server.sh --auto --archive /root/prometey.tgz$dataArg; echo `$? > /root/prometey-install.exit' > /root/prometey-install.log 2>&1 < /dev/null & echo started"
if ($user -ne 'root') { $start = "sudo bash -c `"$start`"" }
$started = $false
for ($try = 1; $try -le 5 -and -not $started; $try++) {
  $oldEA = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  $r = (& ssh @sshOpts $target $start 2>$null | Out-String)
  $ErrorActionPreference = $oldEA
  if ($r -match 'started') { $started = $true } elseif ($try -lt 5) { Start-Sleep -Seconds 10 }
}
if (-not $started) { Fail "Не удалось запустить установку: сервер не отвечает. Подождите 5 минут и запустите снова." }

# следим за ходом установки
$shown = 0; $exit = ''; $misses = 0
for ($i = 0; $i -lt 240 -and $exit -eq ''; $i++) {
  Start-Sleep -Seconds 10
  $oldEA = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  $out = (& ssh @sshOpts $target "sed -n '$($shown+1),`$p' /root/prometey-install.log 2>/dev/null; echo ===EXIT=`$(cat /root/prometey-install.exit 2>/dev/null)" 2>$null | Out-String)
  $ErrorActionPreference = $oldEA
  if ($out -notmatch '===EXIT=') { $misses++; if ($misses % 3 -eq 1) { Write-Host "   (сервер на минуту не отвечает — установка на нём продолжается, жду…)" -ForegroundColor Yellow }; continue }
  $misses = 0
  $parts = $out -split "===EXIT="
  $lines = @(($parts[0] -replace "$([char]27)\[[0-9;]*m", '') -split "`r?`n" | Where-Object { $_ -ne '' })
  foreach ($l in $lines) { Write-Host "   $l" }
  $shown += $lines.Count
  $exit = $parts[1].Trim()
}
if ($exit -eq '') { Fail "Установка идёт дольше 40 минут. Подождите ещё и запустите РАЗМЕСТИТЬ НА СЕРВЕРЕ снова — повторный запуск безопасен." }
if ($exit -ne '0') { Fail "Установка на сервере завершилась с ошибкой (код $exit). Сделайте снимок экрана с текстом выше и пришлите его." }

$oldEA = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
$link = (& ssh @sshOpts $target 'cat /root/prometey-link.txt' 2>$null | Out-String).Trim()
$ErrorActionPreference = $oldEA
if (-not $link) { $link = "http://$ip/" }
Write-Host ""
Write-Host "==================================================================" -ForegroundColor Green
Write-Host "  ГОТОВО! ПРОМЕТЕЙ работает на сервере:  http://$ip" -ForegroundColor Green
if ($link -match '#setup=') { Write-Host "  Сейчас откроется страница — создайте учётную запись руководителя." -ForegroundColor Green }
elseif ($dataArg) { Write-Host "  Входите прежним логином и паролем — все данные перенесены." -ForegroundColor Green }
Write-Host "==================================================================" -ForegroundColor Green
try { Start-Process $link } catch {}
Read-Host "Нажмите Enter, чтобы закрыть"
