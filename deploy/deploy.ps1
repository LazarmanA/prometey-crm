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

# --- адрес сервера (запоминаем для следующих обновлений) ---
$cfg = Join-Path $here 'server.txt'
$savedIp = ''; $savedUser = 'root'
if (Test-Path $cfg) { $l = Get-Content $cfg; $savedIp = $l[0]; if ($l.Count -gt 1 -and $l[1]) { $savedUser = $l[1] } }

$ip = Read-Host "IP-адрес сервера$(if ($savedIp) { " [$savedIp]" })"
if (-not $ip) { $ip = $savedIp }
$ip = $ip.Trim()
if (-not $ip) { Fail "IP-адрес не введён. Он есть в письме или в панели хостинга." }
$user = Read-Host "Пользователь [$savedUser]"
if (-not $user) { $user = $savedUser }
Set-Content -Path $cfg -Value @($ip, $user) -Encoding ASCII

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
$sshOpts = @('-o','StrictHostKeyChecking=accept-new','-o','ServerAliveInterval=30')

Write-Host ""
Write-Host "Сейчас дважды спросят ПАРОЛЬ от сервера (root). При вводе символы НЕ видны — это нормально." -ForegroundColor Yellow
Write-Host "Пароль можно вставить правой кнопкой мыши, затем Enter." -ForegroundColor Yellow
Write-Host ""

Info "Отправляю файлы на сервер (1/2)…"
& scp @sshOpts $arch $installer "${target}:/root/"
if ($LASTEXITCODE -ne 0) { Fail "Не удалось отправить файлы. Проверьте IP и пароль." }
Ok "Файлы на сервере"

Info "Запускаю установку на сервере (2/2). Это займёт 5–15 минут…"
$remote = "sed -i 's/\r`$//' /root/install-server.sh && bash /root/install-server.sh --archive /root/prometey.tgz"
if ($user -ne 'root') { $remote = "sudo bash -c `"$remote`"" }
& ssh -t @sshOpts $target $remote
if ($LASTEXITCODE -ne 0) { Fail "Установка завершилась с ошибкой. Сделайте снимок экрана и пришлите его." }

Write-Host ""
Ok "Готово! Адрес CRM показан выше в зелёной рамке."
Read-Host "Нажмите Enter, чтобы закрыть"
