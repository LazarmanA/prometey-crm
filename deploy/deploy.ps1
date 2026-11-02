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
$ip = ''; $user = 'root'
if (Test-Path $cfg) { $l = @(Get-Content $cfg); if ($l.Count -gt 0) { $ip = "$($l[0])".Trim() }; if ($l.Count -gt 1 -and "$($l[1])".Trim()) { $user = "$($l[1])".Trim() } }
# защита от случайно вписанного пароля: адрес — только цифры и точки (или домен), пользователь — латиница в нижнем регистре
if ($ip -notmatch '^(\d{1,3}\.){3}\d{1,3}$' -and $ip -notmatch '^[a-z0-9.-]+\.[a-z]{2,}$') { $ip = '' }
if ($user -cnotmatch '^(root|ubuntu|admin)$') { $user = 'root' }  # на серверах Рег.облака вход всегда root
if (-not $ip) {
  $ip = (Read-Host "Введите IP-адрес сервера (например 89.108.70.182)").Trim()
  if ($ip -notmatch '^(\d{1,3}\.){3}\d{1,3}$' -and $ip -notmatch '^[a-z0-9.-]+\.[a-z]{2,}$') { Fail "'$ip' — это не IP-адрес. IP выглядит так: 89.108.70.182" }
}
Set-Content -Path $cfg -Value @($ip, $user) -Encoding ASCII
Ok "Сервер: $user@$ip"

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
$base = @('-o','StrictHostKeyChecking=accept-new','-o','ServerAliveInterval=30','-o','ConnectTimeout=25')

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

Info "Отправляю файлы на сервер (1/2)…"
$sent = $false
for ($try = 1; $try -le 5 -and -not $sent; $try++) {
  & scp @sshOpts $arch $installer "${target}:/root/"
  if ($LASTEXITCODE -eq 0) { $sent = $true } elseif ($try -lt 5) { Info "Сервер не ответил — повтор через 10 секунд ($($try+1)/5)…"; Start-Sleep -Seconds 10 }
}
if (-not $sent) { Fail "Не удалось отправить файлы: сервер не отвечает. Подождите 5 минут и запустите снова." }
Ok "Файлы на сервере"

Info "Запускаю установку на сервере (2/2). Это займёт 5–15 минут…"
$remote = "sed -i 's/\r`$//' /root/install-server.sh && bash /root/install-server.sh --archive /root/prometey.tgz"
if ($user -ne 'root') { $remote = "sudo bash -c `"$remote`"" }
# Сервер в интернете иногда не отвечает с первого раза (его «простукивают» боты) — пробуем до 5 раз.
for ($try = 1; $try -le 5; $try++) {
  & ssh -t @sshOpts $target $remote
  $code = $LASTEXITCODE
  if ($code -eq 0) { break }
  if ($code -ne 255 -or $try -eq 5) { Fail "Установка завершилась с ошибкой. Сделайте снимок экрана и пришлите его." }
  Write-Host ""
  Info "Сервер не ответил — повторяю через 10 секунд ($($try+1)/5)…"
  Start-Sleep -Seconds 10
}

Write-Host ""
Ok "Готово! Адрес CRM показан выше в зелёной рамке."
Read-Host "Нажмите Enter, чтобы закрыть"
