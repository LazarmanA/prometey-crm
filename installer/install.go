package main

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ---------- ход установки для окна ----------

type Step struct {
	Name   string `json:"name"`
	Status string `json:"status"` // wait | run | ok | warn | error
	Detail string `json:"detail"`
}

type Progress struct {
	mu       sync.Mutex
	Steps    []Step   `json:"steps"`
	Done     bool     `json:"done"`
	Error    string   `json:"error"`
	URL      string   `json:"url"`
	Login    string   `json:"login"`
	Password string   `json:"password"` // временный пароль — только если выдан сейчас
	Setup    bool     `json:"setup"`    // новая установка: руководитель создаёт учётную запись в CRM
	LAN      string   `json:"lan"`      // адрес для коллег в офисной сети
	Updated  bool     `json:"updated"`
	Warnings []string `json:"warnings"`
}

func newProgress(names ...string) *Progress {
	p := &Progress{Warnings: []string{}}
	for _, n := range names {
		p.Steps = append(p.Steps, Step{Name: n, Status: "wait"})
	}
	return p
}

func (p *Progress) set(i int, status, detail string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.Steps[i].Status, p.Steps[i].Detail = status, detail
}

func (p *Progress) warn(msg string) { p.mu.Lock(); p.Warnings = append(p.Warnings, msg); p.mu.Unlock() }

func (p *Progress) snapshot() []byte {
	p.mu.Lock()
	defer p.mu.Unlock()
	b, _ := json.Marshal(p)
	return b
}

var installSteps = []string{"Подготовка", "Node.js", "Файлы программы", "Настройки", "Доступ из офисной сети", "Автозапуск и ярлыки", "Запуск"}

// tempPassword: 4 группы по 4 символа без похожих букв (l/1, O/0), есть строчные, заглавные и цифры.
func tempPassword() string {
	sets := []string{"abcdefghjkmnpqrstuvwxyz", "ABCDEFGHJKMNPQRSTUVWXYZ", "23456789"}
	var b strings.Builder
	for g := 0; g < 4; g++ {
		for i := 0; i < 4; i++ {
			set := sets[(g+i)%3]
			n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(set))))
			b.WriteByte(set[n.Int64()])
		}
		if g < 3 {
			b.WriteByte('-')
		}
	}
	return b.String()
}

func portFree(port int) bool {
	l, err := net.Listen("tcp", "127.0.0.1:"+strconv.Itoa(port))
	if err != nil {
		return false
	}
	l.Close()
	l, err = net.Listen("tcp", ":"+strconv.Itoa(port))
	if err != nil {
		return false
	}
	l.Close()
	return true
}

func freePort(from int) int {
	for p := from; p < from+200; p++ {
		if portFree(p) {
			return p
		}
	}
	return from
}

// ---------- сервер CRM ----------

func nodeCmd(L Layout, args ...string) *exec.Cmd {
	cmd := exec.Command(L.NodePath(), args...)
	cmd.Dir = L.App
	hideWindow(cmd)
	return cmd
}

// startCRM запускает сторожа в фоне (он сам запускает сервер и перезапускает его при сбое).
func startCRM(L Layout) error {
	cmd := nodeCmd(L, L.Launcher(), "--detach")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%v %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

func stopCRM(L Layout) {
	if fileExists(L.Launcher()) && fileExists(L.NodePath()) {
		nodeCmd(L, L.Launcher(), "--stop").Run()
	}
}

type Health struct {
	OK       bool   `json:"ok"`
	Version  string `json:"version"`
	Database string `json:"database"`
	PdfReady bool   `json:"pdfReady"`
}

// health: 200 — всё в порядке, 503 — работает, но, например, нет PDF. Оба ответа значат «сервер запущен».
func health(port int) (*Health, error) {
	c := http.Client{Timeout: 3 * time.Second}
	resp, err := c.Get(fmt.Sprintf("http://127.0.0.1:%d/api/health", port))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var h Health
	if err := json.NewDecoder(resp.Body).Decode(&h); err != nil {
		return nil, err
	}
	if h.Database != "ok" {
		return &h, errors.New("база данных недоступна")
	}
	return &h, nil
}

func waitHealthy(port int, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	var last error
	for time.Now().Before(deadline) {
		if _, err := health(port); err == nil {
			return nil
		} else {
			last = err
		}
		time.Sleep(700 * time.Millisecond)
	}
	return last
}

func tailFile(path string, lines int) string {
	b, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	if len(b) > 64*1024 {
		b = b[len(b)-64*1024:]
	}
	all := strings.Split(strings.TrimRight(string(b), "\r\n"), "\n")
	if len(all) > lines {
		all = all[len(all)-lines:]
	}
	return strings.Join(all, "\n")
}

func runBackup(L Layout) error {
	cmd := nodeCmd(L, "--disable-warning=ExperimentalWarning", filepath.Join(L.App, "scripts", "full-backup.js"))
	env := os.Environ()
	vals, _ := readEnv(L.Env)
	for k, v := range vals {
		env = append(env, k+"="+v)
	}
	cmd.Env = append(env, "BACKUP_DIR="+L.Backups)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%v: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

// ---------- установка и обновление: без вопросов ----------

func install(L Layout, p *Progress) {
	existing, _ := readInfo(L)
	step := 0
	fail := func(err error) {
		p.set(step, "error", err.Error())
		p.mu.Lock()
		p.Error, p.Done = err.Error(), true
		p.mu.Unlock()
	}
	next := func(detail string) { p.set(step, "ok", detail); step++ }
	run := func(detail string) { p.set(step, "run", detail) }

	// 1. Подготовка: папки; при обновлении — остановка и резервная копия
	run("")
	for _, d := range []string{L.Base, L.App, L.Runtime, L.Data, L.Logs, L.Backups} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			fail(fmt.Errorf("не удалось создать папку %s: %w", d, err))
			return
		}
	}
	if existing != nil || fileExists(L.Launcher()) {
		run("останавливаю прежнюю версию…")
		stopCRM(L)
		if fileExists(filepath.Join(L.Data, "prometey.sqlite")) && fileExists(L.NodePath()) && fileExists(filepath.Join(L.App, "scripts", "full-backup.js")) {
			run("резервная копия данных…")
			if err := runBackup(L); err != nil {
				fail(fmt.Errorf("резервная копия перед обновлением не создана, обновление остановлено: %v", err))
				return
			}
		}
		p.mu.Lock()
		p.Updated = existing != nil
		p.mu.Unlock()
		next("прежняя версия остановлена, данные сохранены")
	} else {
		next(L.Base)
	}

	// 2. Node.js (встроен в установщик)
	run("")
	if err := ensureNode(L, func(s string) { run(s) }); err != nil {
		fail(err)
		return
	}
	major, minor, _ := nodeVersion(L.NodePath())
	next(fmt.Sprintf("Node.js %d.%d", major, minor))

	// 3. Файлы программы (данные в папке data не трогаются)
	run("")
	tmp := L.App + ".new"
	if err := removeAllRetry(tmp); err != nil {
		fail(err)
		return
	}
	if err := unzipTo(appZip, tmp, 0); err != nil {
		fail(err)
		return
	}
	if err := replaceDir(tmp, L.App); err != nil {
		fail(err)
		return
	}
	next("версия " + Version)

	// 4. Настройки: при первой установке — логин руководителя и временный пароль
	run("")
	env, _ := readEnv(L.Env)
	port := 0
	if existing != nil && existing.Port > 0 {
		port = existing.Port
	} else if v, err := strconv.Atoi(env["PORT"]); err == nil && v > 0 {
		port = v
	} else {
		port = freePort(3030)
	}
	// Коллеги в офисе открывают CRM по адресу компьютера в сети. Выключить можно в CRM: «Администрирование → Сервер».
	host := "0.0.0.0"
	if env["PROMETEY_NETWORK"] == "off" {
		host = "127.0.0.1"
	}
	upd := map[string]string{
		"NODE_ENV": "production", "HOST": host, "PORT": strconv.Itoa(port), "COOKIE_SECURE": "false", "SESSION_TTL_HOURS": "12",
		"DB_FILE": filepath.Join(L.Data, "prometey.sqlite"), "DOCUMENTS_DIR": filepath.Join(L.Data, "documents"),
		"RECORDINGS_DIR": filepath.Join(L.Data, "recordings"), "BACKUP_DIR": L.Backups,
		"DATA_FILE": filepath.Join(L.App, "storage", "data.demo.json"),
	}
	var remove []string
	if licenseServer != "" && licenseKey != "" {
		upd["PROMETEY_LICENSE_SERVER"], upd["PROMETEY_LICENSE_KEY"] = licenseServer, licenseKey
	}
	pdf := detectPDF()
	for key, val := range map[string]string{"PROMETEY_LIBREOFFICE": pdf.libreoffice, "PROMETEY_CHROMIUM": pdf.browser} {
		if val != "" {
			upd[key] = val
		} else {
			remove = append(remove, key)
		}
	}
	// Новая установка: никаких временных паролей — руководитель сам создаёт учётную запись в CRM,
	// остальных приглашает ссылкой. Прежние установки с паролем из установщика продолжают работать как раньше.
	password, setupToken := "", ""
	if env["PROMETEY_ADMIN_PASSWORD"] == "" {
		setupToken = env["PROMETEY_SETUP_TOKEN"]
		if setupToken == "" || existing == nil {
			setupToken = randomToken()
		}
		upd["PROMETEY_SETUP"], upd["PROMETEY_SETUP_TOKEN"] = "1", setupToken
	}
	if err := writeEnv(L.Env, upd, remove); err != nil {
		fail(err)
		return
	}
	env, _ = readEnv(L.Env)
	info := &InstallInfo{Version: Version, Port: port, AdminEmail: env["PROMETEY_ADMIN_EMAIL"], InstalledAt: nowISO(), UpdatedAt: nowISO()}
	if existing != nil {
		info.InstalledAt = existing.InstalledAt
	}
	next(fmt.Sprintf("порт %d", port))

	// 5. Доступ из офисной сети: правило брандмауэра Windows (один вопрос «Разрешить?»)
	lan := ""
	if host == "0.0.0.0" {
		run("Windows спросит разрешение — нажмите «Да»")
		if ips := lanIPs(); len(ips) > 0 {
			lan = fmt.Sprintf("http://%s:%d/", ips[0], port)
		}
		if err := allowFirewall(L, port); err != nil {
			p.set(step, "warn", err.Error())
			p.warn("Коллеги в офисе пока не смогут открыть CRM: брандмауэр Windows не настроен (" + err.Error() + "). Запустите установщик ещё раз и в окне Windows нажмите «Да».")
			step++
		} else if lan != "" {
			next("коллеги открывают " + lan)
		} else {
			next("компьютер пока не подключён к локальной сети")
		}
	} else {
		next("выключен в CRM")
	}

	// 6. Автозапуск и ярлыки — для текущего пользователя, без прав администратора
	run("")
	shortcuts, err := integrate(L, port)
	info.Shortcuts = shortcuts
	if werr := writeInfo(L, info); werr != nil {
		fail(werr)
		return
	}
	if err != nil {
		p.set(step, "warn", err.Error())
		p.warn("Не всё удалось настроить: " + err.Error() + ". CRM работает; если после перезагрузки она не откроется — запустите установщик ещё раз.")
		step++
	} else {
		next("запуск вместе с Windows, ярлык на рабочем столе")
	}

	// 7. Запуск и проверка
	run("запускаю…")
	if err := startCRM(L); err != nil {
		fail(fmt.Errorf("не удалось запустить CRM: %v", err))
		return
	}
	if err := waitHealthy(port, 90*time.Second); err != nil {
		fail(fmt.Errorf("CRM не ответила: %v. Последние строки журнала:\n%s", err, tailFile(filepath.Join(L.Logs, "prometey.log"), 15)))
		return
	}
	if h, _ := health(port); h != nil && !h.PdfReady {
		p.warn("PDF-документы не формируются: не найден Microsoft Edge или LibreOffice. Установите бесплатный LibreOffice и запустите установщик ещё раз.")
	}
	next("работает")

	p.mu.Lock()
	p.URL = fmt.Sprintf("http://localhost:%d/", port)
	p.Setup, p.LAN = setupToken != "" && setupPending(port), lan
	if p.Setup {
		p.URL += "#setup=" + setupToken
	}
	p.Login, p.Password, p.Done = info.AdminEmail, password, true
	p.mu.Unlock()
}

// resetAdminPassword: руководитель забыл пароль — CRM открывается на этом компьютере со страницей,
// где он заново задаёт e-mail и пароль (данные не меняются). Возвращает адрес этой страницы.
func resetAdminPassword(L Layout) (string, string, error) {
	info, err := readInfo(L)
	if err != nil {
		return "", "", errors.New("ПРОМЕТЕЙ не установлен")
	}
	token := randomToken()
	if err := writeEnv(L.Env, map[string]string{"PROMETEY_SETUP": "1", "PROMETEY_SETUP_TOKEN": token, "PROMETEY_RESET_OWNER": token},
		[]string{"PROMETEY_ADMIN_EMAIL", "PROMETEY_ADMIN_PASSWORD", "PROMETEY_ADMIN_MUST_CHANGE"}); err != nil {
		return "", "", err
	}
	stopCRM(L)
	if err := startCRM(L); err != nil {
		return "", "", err
	}
	if err := waitHealthy(info.Port, 90*time.Second); err != nil {
		return "", "", fmt.Errorf("CRM не запустилась: %v", err)
	}
	return fmt.Sprintf("http://localhost:%d/#setup=%s", info.Port, token), "", nil
}

func randomToken() string {
	b := make([]byte, 18)
	rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

// setupPending: CRM ждёт, что руководитель создаст учётную запись.
func setupPending(port int) bool {
	c := http.Client{Timeout: 3 * time.Second}
	resp, err := c.Get(fmt.Sprintf("http://127.0.0.1:%d/api/setup", port))
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	var s struct {
		Needed bool `json:"needed"`
	}
	json.NewDecoder(resp.Body).Decode(&s)
	return s.Needed
}

type BackupItem struct {
	Name string `json:"name"`
	At   string `json:"at"`
}

func listBackups(L Layout) []BackupItem {
	entries, _ := os.ReadDir(L.Backups)
	out := []BackupItem{}
	for _, e := range entries {
		if info, err := e.Info(); err == nil && e.IsDir() && strings.HasPrefix(e.Name(), "prometey-") {
			out = append(out, BackupItem{Name: e.Name(), At: info.ModTime().Format(time.RFC3339)})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].At > out[j].At })
	return out
}
