// ПРОМЕТЕЙ CRM — установщик для Windows.
//
// Двойной щелчок — и всё: без вопросов, без прав администратора, без запроса «Разрешить изменения».
// Программа ставится в папку пользователя (%LOCALAPPDATA%\Prometey), запускается вместе с Windows
// и открывается в браузере. После установки работает только подписанный node.exe (Node.js) —
// антивирусы его не блокируют; сторож сервера, резервные копии и удаление — скрипты внутри CRM.
//
// Повторный запуск установщика обновляет программу (данные сохраняются) и умеет выдать новый
// временный пароль руководителя, если его забыли.
package main

import (
	_ "embed"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

//go:embed app.zip
var appZip []byte

//go:embed ui/setup.html
var setupHTML string

// Version задаётся при сборке: -ldflags "-X main.Version=1.4.2"
var Version = "dev"

// Пульт продавца (задаются при сборке): CRM сообщает ему о себе и получает состояние подписки.
var (
	licenseServer = ""
	licenseKey    = ""
)

const (
	productName = "ПРОМЕТЕЙ CRM"
	runValue    = "PrometeyCRM"
	runKey      = `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`
	uninstKey   = `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\PrometeyCRM`
)

func main() {
	args := os.Args[1:]
	if len(args) > 0 && (args[0] == "version" || args[0] == "--version") {
		fmt.Println(Version)
		return
	}
	fs := flag.NewFlagSet("prometey", flag.ContinueOnError)
	baseFlag := fs.String("base", "", "папка установки (для проверки)")
	noBrowser := fs.Bool("no-browser", false, "не открывать браузер (для проверки)")
	uiPort := fs.Int("ui-port", 0, "порт окна установщика (для проверки)")
	if err := fs.Parse(args); err != nil {
		os.Exit(2)
	}
	base := *baseFlag
	if base == "" {
		base = defaultBase()
	}
	base, _ = filepath.Abs(base)
	serveUI(layoutFor(base), uiOptions{noBrowser: *noBrowser, port: *uiPort})
}

func fileExists(p string) bool { _, err := os.Stat(p); return err == nil }

func samePath(a, b string) bool {
	a, _ = filepath.Abs(a)
	b, _ = filepath.Abs(b)
	return strings.EqualFold(filepath.Clean(a), filepath.Clean(b))
}
