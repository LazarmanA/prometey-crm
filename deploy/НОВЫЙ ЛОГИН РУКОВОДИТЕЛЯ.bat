@chcp 65001 >nul & powershell -NoProfile -ExecutionPolicy Bypass -Command "$f='%~f0'; iex ((Get-Content -LiteralPath $f -Encoding UTF8 | Select-Object -Skip 2) -join [char]10)" & exit /b
rem ---- ниже PowerShell ----
# ПРОМЕТЕЙ CRM: задать новый логин (e-mail) и пароль руководителя на сервере. Данные CRM не меняются.
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
function Ok($t)   { Write-Host "OK  $t" -ForegroundColor Green }
function Info($t) { Write-Host ">>  $t" -ForegroundColor Cyan }
function Fail($t) { Write-Host ""; Write-Host "ОШИБКА: $t" -ForegroundColor Red; Read-Host "Нажмите Enter, чтобы закрыть"; exit 1 }
trap { Fail $_.Exception.Message }

Write-Host ""
Write-Host "=== ПРОМЕТЕЙ CRM: новый логин и пароль руководителя ===" -ForegroundColor Magenta
Write-Host ""

$ip = '89.108.70.182'; $port = '22'
foreach ($cfg in @((Join-Path (Split-Path $f) 'deploy\server.txt'), "$env:USERPROFILE\Desktop\СЕРВЕР\deploy\server.txt", "$env:USERPROFILE\Desktop\прометей\СЕРВЕР\deploy\server.txt")) {
  if (Test-Path -LiteralPath $cfg) { $l = @(Get-Content -LiteralPath $cfg); if ("$($l[0])".Trim() -match '^(\d{1,3}\.){3}\d{1,3}$') { $ip = "$($l[0])".Trim() }; if ($l.Count -gt 2 -and "$($l[2])".Trim() -match '^\d{1,5}$') { $port = "$($l[2])".Trim() }; break }
}
$key = Join-Path $env:USERPROFILE '.ssh\prometey_ed25519'
if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) { Fail "В Windows нет программы ssh (Клиент OpenSSH)." }
if (-not (Test-Path -LiteralPath $key)) { Fail "На этом компьютере нет ключа доступа к серверу. Запустите этот файл на компьютере, с которого устанавливали ПРОМЕТЕЙ на сервер." }
$opts = @('-o',"Port=$port",'-o','StrictHostKeyChecking=accept-new','-o','ConnectTimeout=25','-o','BatchMode=yes','-i',$key,'-o','IdentitiesOnly=yes')
Ok "Сервер: $ip"

# на сервере: включить «восстановление доступа» с новым одноразовым ключом и перезапустить CRM
$remote = @'
set -e
F=/etc/prometey.env
T=$(head -c 18 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=\n')
sed -i '/^PROMETEY_SETUP=/d;/^PROMETEY_SETUP_TOKEN=/d;/^PROMETEY_RESET_OWNER=/d;/^PROMETEY_ADMIN_EMAIL=/d;/^PROMETEY_ADMIN_PASSWORD=/d;/^PROMETEY_ADMIN_MUST_CHANGE=/d' "$F"
printf 'PROMETEY_SETUP=1\nPROMETEY_SETUP_TOKEN=%s\nPROMETEY_RESET_OWNER=%s\n' "$T" "$T" >> "$F"
systemctl restart prometey
for i in $(seq 1 30); do R=$(curl -s --max-time 3 http://127.0.0.1/api/setup || true); case "$R" in *needed*) break;; esac; sleep 1; done
echo "SETUP=$R"
echo "TOKEN=$T"
'@
Info "Подключаюсь к серверу (пароль не нужен — вход по ключу)…"
$oldEA = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($remote -replace "`r", '')))
$out = (& ssh @opts "root@$ip" "echo $b64 | base64 -d | bash" 2>&1 | Out-String)
$ErrorActionPreference = $oldEA
if ($out -match 'Permission denied') { Fail "Сервер не принял ключ доступа. Запустите сначала «РАЗМЕСТИТЬ НА СЕРВЕРЕ» (он спросит пароль root и настроит ключ), затем этот файл." }
$token = ([regex]::Match($out, 'TOKEN=([A-Za-z0-9_-]{20,})')).Groups[1].Value
if (-not $token -or $out -notmatch '"needed":true') { Write-Host $out; Fail "CRM на сервере не перешла в режим восстановления доступа. Сделайте снимок экрана и пришлите его." }
Ok "CRM на сервере готова принять новый логин и пароль руководителя"

$url = "http://$ip/#setup=$token"
Write-Host ""
Write-Host "==================================================================" -ForegroundColor Green
Write-Host "  Сейчас откроется страница «Восстановление доступа»." -ForegroundColor Green
Write-Host "  Впишите СВОЙ e-mail — это будет логин, и придумайте пароль" -ForegroundColor Green
Write-Host "  (от 12 символов: заглавные, строчные буквы и цифры)." -ForegroundColor Green
Write-Host "  Нажмите «Сохранить и войти». Все данные CRM сохранятся." -ForegroundColor Green
Write-Host "==================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Если страница не открылась сама, откройте в браузере:"
Write-Host "  $url" -ForegroundColor Yellow
try { Start-Process $url } catch {}
Read-Host "Нажмите Enter, чтобы закрыть это окно"
