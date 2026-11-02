package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"
)

// Layout — расположение файлов установленной программы (папка пользователя, права администратора не нужны).
//
//	<base>\runtime\node.exe   Node.js (подписан OpenJS Foundation)
//	<base>\app\               код CRM (заменяется при обновлении); app\scripts\windows-launcher.js — сторож сервера
//	<base>\data\              база, документы, записи звонков, бэкапы, журнал — при обновлении не трогаются
//	<base>\prometey.env        настройки сервера и пароли
//	<base>\install.json        сведения об установке
type Layout struct {
	Base, App, Runtime, Data, Logs, Backups, Env, Info string
}

func layoutFor(base string) Layout {
	data := filepath.Join(base, "data")
	return Layout{
		Base: base, App: filepath.Join(base, "app"), Runtime: filepath.Join(base, "runtime"),
		Data: data, Logs: filepath.Join(data, "logs"), Backups: filepath.Join(data, "backups"),
		Env: filepath.Join(base, "prometey.env"), Info: filepath.Join(base, "install.json"),
	}
}

func (L Layout) Launcher() string  { return filepath.Join(L.App, "scripts", "windows-launcher.js") }
func (L Layout) Uninstall() string { return filepath.Join(L.App, "scripts", "windows-uninstall.js") }

// NodePath — Node.js, который использует CRM. Для проверки на Linux его подменяет PROMETEY_TEST_NODE.
func (L Layout) NodePath() string {
	if p := os.Getenv("PROMETEY_TEST_NODE"); p != "" {
		return p
	}
	if runtime.GOOS == "windows" {
		return filepath.Join(L.Runtime, "node.exe")
	}
	return filepath.Join(L.Runtime, "bin", "node")
}

type InstallInfo struct {
	Version     string   `json:"version"`
	Port        int      `json:"port"`
	AdminEmail  string   `json:"adminEmail,omitempty"`
	Shortcuts   []string `json:"shortcuts,omitempty"`
	InstalledAt string   `json:"installedAt"`
	UpdatedAt   string   `json:"updatedAt"`
}

func readInfo(L Layout) (*InstallInfo, error) {
	b, err := os.ReadFile(L.Info)
	if err != nil {
		return nil, err
	}
	var x InstallInfo
	if err := json.Unmarshal(b, &x); err != nil {
		return nil, fmt.Errorf("повреждён install.json: %w", err)
	}
	return &x, nil
}

func writeInfo(L Layout, x *InstallInfo) error {
	b, _ := json.MarshalIndent(x, "", "  ")
	return writeFileAtomic(L.Info, append(b, '\n'), 0o644)
}

// ---------- prometey.env: KEY=VALUE, строки с # — комментарии ----------

func readEnv(path string) (map[string]string, []string) {
	vals := map[string]string{}
	var order []string
	f, err := os.Open(path)
	if err != nil {
		return vals, order
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 64*1024), 1024*1024)
	for sc.Scan() {
		line := strings.TrimSpace(strings.TrimPrefix(sc.Text(), "\uFEFF"))
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		i := strings.IndexByte(line, '=')
		if i <= 0 {
			continue
		}
		k, v := strings.TrimSpace(line[:i]), line[i+1:]
		if len(v) >= 2 && v[0] == '\'' && v[len(v)-1] == '\'' {
			v = v[1 : len(v)-1]
		}
		if _, seen := vals[k]; !seen {
			order = append(order, k)
		}
		vals[k] = v
	}
	return vals, order
}

// writeEnv сохраняет настройки: известные ключи обновляются, ключи, добавленные вручную (например YANDEX_MAPS_API_KEY), остаются.
func writeEnv(path string, updates map[string]string, remove []string) error {
	vals, order := readEnv(path)
	for _, k := range remove {
		delete(vals, k)
	}
	for k, v := range updates {
		if _, ok := vals[k]; !ok {
			order = append(order, k)
		}
		vals[k] = v
	}
	var b strings.Builder
	b.WriteString("# Настройки ПРОМЕТЕЙ CRM. После изменения перезапустите CRM в «Управление ПРОМЕТЕЙ».\r\n")
	seen := map[string]bool{}
	for _, k := range order {
		if v, ok := vals[k]; ok && !seen[k] {
			seen[k] = true
			b.WriteString(k + "=" + v + "\r\n")
		}
	}
	rest := []string{}
	for k := range vals {
		if !seen[k] {
			rest = append(rest, k)
		}
	}
	sort.Strings(rest)
	for _, k := range rest {
		b.WriteString(k + "=" + vals[k] + "\r\n")
	}
	return writeFileAtomic(path, []byte(b.String()), 0o600)
}

func writeFileAtomic(path string, data []byte, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, mode); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func nowISO() string { return time.Now().Format(time.RFC3339) }
