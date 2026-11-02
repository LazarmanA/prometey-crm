//go:build windows

package main

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"
)

var (
	shell32           = syscall.NewLazyDLL("shell32.dll")
	user32            = syscall.NewLazyDLL("user32.dll")
	ole32             = syscall.NewLazyDLL("ole32.dll")
	procShellExecute  = shell32.NewProc("ShellExecuteW")
	procKnownFolder   = shell32.NewProc("SHGetKnownFolderPath")
	procMessageBox    = user32.NewProc("MessageBoxW")
	procCoTaskMemFree = ole32.NewProc("CoTaskMemFree")
)

const createNoWindow = 0x08000000

func u16(s string) *uint16 { p, _ := syscall.UTF16PtrFromString(s); return p }

func infoBox(msg string) {
	procMessageBox.Call(0, uintptr(unsafe.Pointer(u16(msg))), uintptr(unsafe.Pointer(u16(productName))), 0x40)
}

func fatalBox(msg string) {
	procMessageBox.Call(0, uintptr(unsafe.Pointer(u16(msg))), uintptr(unsafe.Pointer(u16(productName))), 0x10)
	os.Exit(1)
}

// defaultBase — папка пользователя: права администратора не нужны, антивирусы её не ограничивают.
func defaultBase() string {
	if d := os.Getenv("LOCALAPPDATA"); d != "" {
		return filepath.Join(d, "Prometey")
	}
	h, _ := os.UserHomeDir()
	return filepath.Join(h, "AppData", "Local", "Prometey")
}

func hideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
}

func sys32(exe string) string {
	root := os.Getenv("SystemRoot")
	if root == "" {
		root = `C:\Windows`
	}
	return filepath.Join(root, "System32", exe)
}

// run выполняет системную команду без окна; сообщения Windows приходят в кодировке CP866.
func run(name string, args ...string) (string, error) {
	cmd := exec.Command(name, args...)
	hideWindow(cmd)
	out, err := cmd.CombinedOutput()
	text := strings.TrimSpace(decode866(out))
	if err != nil {
		if text == "" {
			text = err.Error()
		}
		return text, fmt.Errorf("%s: %s", filepath.Base(name), text)
	}
	return text, nil
}

func decode866(b []byte) string {
	if !bytes.ContainsFunc(b, func(r rune) bool { return r >= 0x80 }) || strings.ToValidUTF8(string(b), "\uFFFD") == string(b) {
		return string(b)
	}
	var sb strings.Builder
	for _, c := range b {
		switch {
		case c < 0x80:
			sb.WriteByte(c)
		case c <= 0xAF:
			sb.WriteRune(rune(0x0410 + int(c) - 0x80))
		case c >= 0xE0 && c <= 0xEF:
			sb.WriteRune(rune(0x0440 + int(c) - 0xE0))
		case c == 0xF0:
			sb.WriteRune('Ё')
		case c == 0xF1:
			sb.WriteRune('ё')
		default:
			sb.WriteRune(' ')
		}
	}
	return sb.String()
}

// knownFolder — настоящий путь к «Рабочему столу» и меню «Пуск» (в том числе перенесённым в OneDrive).
func knownFolder(guid [16]byte, fallback string) string {
	var p *uint16
	r, _, _ := procKnownFolder.Call(uintptr(unsafe.Pointer(&guid[0])), 0, 0, uintptr(unsafe.Pointer(&p)))
	if r != 0 || p == nil {
		return fallback
	}
	defer procCoTaskMemFree.Call(uintptr(unsafe.Pointer(p)))
	return syscall.UTF16ToString((*[1 << 15]uint16)(unsafe.Pointer(p))[:])
}

func guid(d1 uint32, d2, d3 uint16, d4 [8]byte) [16]byte {
	var g [16]byte
	g[0], g[1], g[2], g[3] = byte(d1), byte(d1>>8), byte(d1>>16), byte(d1>>24)
	g[4], g[5], g[6], g[7] = byte(d2), byte(d2>>8), byte(d3), byte(d3>>8)
	copy(g[8:], d4[:])
	return g
}

var (
	folderDesktop  = guid(0xB4BFCC3A, 0xDB2C, 0x424C, [8]byte{0xB0, 0x29, 0x7F, 0xE9, 0x9A, 0x87, 0xC6, 0x41})
	folderPrograms = guid(0xA77F5D77, 0x2E2B, 0x44C3, [8]byte{0xA6, 0xA2, 0xAB, 0xA6, 0x01, 0x05, 0x4A, 0x51})
)

func quote(s string) string { return `"` + s + `"` }

// integrate: автозапуск при входе в Windows (раздел Run текущего пользователя), ярлык на рабочем столе и в «Пуске»,
// пункт в «Параметры → Приложения». Всё в разделе пользователя — без прав администратора и без вопросов.
func integrate(L Layout, port int) ([]string, error) {
	var errs []string
	runCmd := quote(L.NodePath()) + " " + quote(L.Launcher()) + " --detach"
	if _, err := run(sys32("reg.exe"), "add", runKey, "/v", runValue, "/t", "REG_SZ", "/d", runCmd, "/f"); err != nil {
		errs = append(errs, "автозапуск: "+err.Error())
	}
	url := fmt.Sprintf("[InternetShortcut]\r\nURL=http://localhost:%d/\r\n", port)
	home, _ := os.UserHomeDir()
	desktop := knownFolder(folderDesktop, filepath.Join(home, "Desktop"))
	menu := filepath.Join(knownFolder(folderPrograms, filepath.Join(os.Getenv("APPDATA"), `Microsoft\Windows\Start Menu\Programs`)), productName+".url")
	var made []string
	for _, f := range []string{filepath.Join(desktop, productName+".url"), menu} {
		if err := os.WriteFile(f, []byte(url), 0o644); err != nil {
			errs = append(errs, "ярлык: "+err.Error())
		} else {
			made = append(made, f)
		}
	}
	uninstall := quote(L.NodePath()) + " " + quote(L.Uninstall())
	for _, v := range [][3]string{
		{"DisplayName", "REG_SZ", productName}, {"DisplayVersion", "REG_SZ", Version}, {"Publisher", "REG_SZ", "ПРОМЕТЕЙ"},
		{"InstallLocation", "REG_SZ", L.Base}, {"DisplayIcon", "REG_SZ", L.NodePath()}, {"UninstallString", "REG_SZ", uninstall},
		{"NoModify", "REG_DWORD", "1"}, {"NoRepair", "REG_DWORD", "1"},
	} {
		if _, err := run(sys32("reg.exe"), "add", uninstKey, "/v", v[0], "/t", v[1], "/d", v[2], "/f"); err != nil {
			errs = append(errs, "«Приложения»: "+err.Error())
			break
		}
	}
	if len(errs) > 0 {
		return made, errors.New(strings.Join(errs, "; "))
	}
	return made, nil
}

func openBrowser(url string) error {
	r, _, _ := procShellExecute.Call(0, uintptr(unsafe.Pointer(u16("open"))), uintptr(unsafe.Pointer(u16(url))), 0, 0, 1)
	if r <= 32 {
		return errors.New("не удалось открыть браузер")
	}
	return nil
}

func openFolder(path string) {
	exec.Command(filepath.Join(os.Getenv("SystemRoot"), "explorer.exe"), path).Start()
}

type pdfEngines struct{ libreoffice, browser string }

func detectPDF() pdfEngines {
	var e pdfEngines
	roots := []string{os.Getenv("ProgramFiles"), os.Getenv("ProgramFiles(x86)"), os.Getenv("LOCALAPPDATA"), `C:\Program Files`, `C:\Program Files (x86)`}
	find := func(rel string) string {
		for _, r := range roots {
			if r != "" {
				if p := filepath.Join(r, rel); fileExists(p) {
					return p
				}
			}
		}
		return ""
	}
	e.libreoffice = find(`LibreOffice\program\soffice.exe`)
	if e.browser = find(`Microsoft\Edge\Application\msedge.exe`); e.browser == "" {
		e.browser = find(`Google\Chrome\Application\chrome.exe`)
	}
	return e
}
