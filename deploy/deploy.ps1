# =====================================================================
#  ПРОМЕТЕЙ CRM — отправка программы на сервер (запускается из deploy.bat)
#  Первый раз — устанавливает, следующие разы — обновляет (данные сохраняются).
# =====================================================================
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

function Ok($t)   { Write-Host "OK  $t" -ForegroundColor Green }
function Info($t) { Write-Host ">>  $t" -ForegroundColor Cyan }
function Fail($t) { Write-Host "ОШИБКА: $t" -ForegroundColor Red; try { Stop-Transcript | Out-Null } catch {}; Read-Host "Нажмите Enter, чтобы закрыть"; exit 1 }
# журнал всего, что видно в окне: deploy\deploy-log.txt (пришлите его, если что-то пошло не так)
try { Start-Transcript -Path (Join-Path $PSScriptRoot 'deploy-log.txt') -Append | Out-Null } catch {}
# любая непредвиденная ошибка — показать и не закрывать окно
trap { Write-Host ""; Write-Host "ОШИБКА: $($_.Exception.Message)" -ForegroundColor Red; Write-Host "(строка $($_.InvocationInfo.ScriptLineNumber))"; try { Stop-Transcript | Out-Null } catch {}; Read-Host "Сделайте снимок экрана и нажмите Enter, чтобы закрыть"; exit 1 }

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

# Окно Windows для пароля: Ctrl+V работает всегда, можно включить «Показать пароль» и проверить глазами.
function Ask-Password([string]$note) {
  try {
    Add-Type -AssemblyName System.Windows.Forms, System.Drawing
    $f = New-Object Windows.Forms.Form
    $f.Text = 'ПРОМЕТЕЙ — пароль сервера'; $f.Width = 520; $f.Height = 290; $f.StartPosition = 'CenterScreen'; $f.TopMost = $true
    $f.FormBorderStyle = 'FixedDialog'; $f.MaximizeBox = $false; $f.MinimizeBox = $false; $f.Font = New-Object Drawing.Font('Segoe UI', 10)
    $l = New-Object Windows.Forms.Label; $l.Left = 16; $l.Top = 14; $l.Width = 470; $l.Height = 70
    $l.Text = "Вставьте пароль root от сервера $ip из письма Рег.облака:`nщёлкните в поле ниже и нажмите Ctrl+V. Затем «Продолжить»."
    $e = New-Object Windows.Forms.Label; $e.Left = 16; $e.Top = 84; $e.Width = 470; $e.Height = 22; $e.ForeColor = 'Firebrick'; $e.Text = $note
    $t = New-Object Windows.Forms.TextBox; $t.Left = 16; $t.Top = 110; $t.Width = 470; $t.UseSystemPasswordChar = $true
    $c = New-Object Windows.Forms.CheckBox; $c.Left = 16; $c.Top = 145; $c.Width = 300; $c.Text = 'Показать пароль'
    $c.Add_CheckedChanged({ $t.UseSystemPasswordChar = -not $c.Checked })
    $ok = New-Object Windows.Forms.Button; $ok.Left = 300; $ok.Top = 190; $ok.Width = 186; $ok.Height = 36; $ok.Text = 'Продолжить'; $ok.DialogResult = 'OK'
    $no = New-Object Windows.Forms.Button; $no.Left = 186; $no.Top = 190; $no.Width = 100; $no.Height = 36; $no.Text = 'Отмена'; $no.DialogResult = 'Cancel'
    $f.Controls.AddRange(@($l, $e, $t, $c, $ok, $no)); $f.AcceptButton = $ok; $f.CancelButton = $no
    $f.Add_Shown({ $f.Activate(); $t.Focus() })
    if ($f.ShowDialog() -ne 'OK') { return $null }
    return ($t.Text -replace '[\r\n]', '').Trim()   # без пробелов и переносов, которые попадают при копировании из письма
  } catch { return '' }
}

if (Test-Key) { Ok "Вход на сервер по ключу — пароль не нужен" }
else {
  $pub = (Get-Content "$key.pub" -Raw).Trim()
  $addKey = "umask 077; mkdir -p ~/.ssh; touch ~/.ssh/authorized_keys; grep -qxF '$pub' ~/.ssh/authorized_keys || echo '$pub' >> ~/.ssh/authorized_keys"
  # пароль передаётся ssh через временный помощник (SSH_ASKPASS) — вводить его в чёрное окно не нужно
  $askpass = Join-Path $env:TEMP 'prometey-askpass.cmd'
  Set-Content -Path $askpass -Encoding ASCII -Value "@echo off`r`npowershell -NoProfile -NonInteractive -Command `"[Console]::Out.WriteLine(`$env:PROMETEY_PW)`""
  $ok = $false; $note = ''; $console = $false
  for ($try = 1; $try -le 5 -and -not $ok; $try++) {
    $pw = if ($console) { '' } else { Ask-Password $note }
    if ($null -eq $pw) { Fail "Установка отменена." }
    if ($pw) {
      Info "Проверяю пароль…"
      $env:PROMETEY_PW = $pw; $env:SSH_ASKPASS = $askpass; $env:SSH_ASKPASS_REQUIRE = 'force'; if (-not $env:DISPLAY) { $env:DISPLAY = 'localhost:0' }
      $oldEA = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
      $out = (& ssh @base -o PreferredAuthentications=password,keyboard-interactive -o PubkeyAuthentication=no -o NumberOfPasswordPrompts=1 $target $addKey 2>&1 | Out-String)
      $ErrorActionPreference = $oldEA
      Remove-Item Env:PROMETEY_PW, Env:SSH_ASKPASS, Env:SSH_ASKPASS_REQUIRE -ErrorAction SilentlyContinue
      if (Test-Key) { $ok = $true; break }
      if ($out -match 'askpass|ssh_askpass') { $console = $true; Info "Окно для пароля не сработало — введите пароль здесь, как раньше." }
      elseif ($out -match 'Permission denied') { $note = "Пароль не подошёл ($try из 5). Проверьте: это пароль из ПОСЛЕДНЕГО письма?" }
      else { $note = "Сервер не ответил ($try из 5) — попробуйте ещё раз через минуту."; Start-Sleep -Seconds 20 }
    }
    if ($console) {
      Write-Host ""
      Write-Host "Вставьте пароль root: Ctrl+V (или Ctrl+Shift+V) и Enter. Символы не видны — это нормально." -ForegroundColor Yellow
      & ssh @base -o PreferredAuthentications=password,keyboard-interactive -o PubkeyAuthentication=no -o NumberOfPasswordPrompts=1 $target $addKey
      if (Test-Key) { $ok = $true; break }
    }
  }
  Remove-Item $askpass -ErrorAction SilentlyContinue
  if (-not $ok) { Fail "Не удалось войти на сервер: пароль не подошёл. Задайте новый пароль root в панели Рег.облака (меню сервера → сменить пароль) и запустите снова." }
  Ok "Доступ по ключу настроен — больше пароль не понадобится"
}

# --- новый сервер или обновление? ---
$oldEA = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
$state = (& ssh @sshOpts $target 'if pgrep -f ''install-serve[r].sh'' >/dev/null; then echo RUNNING; elif test -f /var/lib/prometey/prometey.sqlite; then echo YES; else echo NO; fi' 2>$null | Out-String).Trim()
$installed = ($state -eq 'YES'); $running = ($state -eq 'RUNNING')
$ErrorActionPreference = $oldEA
$files = @($arch, $installer)
$dataArg = ''
if ($running) { Ok "На сервере уже идёт установка — подключаюсь и показываю, как она продвигается" }
elseif ($installed) { Ok "На сервере уже есть ПРОМЕТЕЙ — обновляю программу, данные сервера сохраняются" }
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

if (-not $running) {
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
}

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
try { Stop-Transcript | Out-Null } catch {}
Read-Host "Нажмите Enter, чтобы закрыть"
