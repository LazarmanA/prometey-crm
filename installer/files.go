package main

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// Официальная сборка Node.js 24 для Windows x64; контрольная сумма сверяется с SHASUMS256.txt того же выпуска.
var nodeMirrors = []string{
	"https://nodejs.org/dist/latest-v24.x/",
	"https://npmmirror.com/mirrors/node/latest-v24.x/",
}

const minNodeMajor = 24

// Node.js для Windows, вшитый в установщик (node.exe + LICENSE). Пустой архив — значит сборка без вшитого Node.js,
// тогда он скачивается. nodeExeSHA256 — контрольная сумма node.exe, записывается при сборке.
//
//go:embed node.zip
var nodeZip []byte
var nodeExeSHA256 = ""

// ---------- файловые операции, устойчивые к антивирусам ----------
// Антивирус (Защитник Windows, 360 Total Security, Касперский) проверяет только что записанные файлы и на это время
// держит их открытыми — переименование или удаление в эту секунду даёт «Access is denied». Поэтому повторяем.

func retry(what string, fn func() error) error {
	var err error
	delay := 200 * time.Millisecond
	for i := 0; i < 25; i++ { // около 40 секунд
		if err = fn(); err == nil {
			return nil
		}
		time.Sleep(delay)
		if delay < 3*time.Second {
			delay += delay / 2
		}
	}
	return fmt.Errorf("%s: %w (файл занят другой программой — возможно, антивирусом)", what, err)
}

func removeAllRetry(path string) error {
	if !fileExists(path) {
		return nil
	}
	return retry("не удалось удалить "+path, func() error {
		err := os.RemoveAll(path)
		if err == nil && fileExists(path) {
			return errors.New("папка ещё существует")
		}
		return err
	})
}

func renameRetry(from, to string) error {
	return retry("не удалось переименовать "+from, func() error { return os.Rename(from, to) })
}

// copyTree — запасной путь, если папку так и не удалось переименовать.
func copyTree(src, dst string) error {
	return filepath.Walk(src, func(p string, fi os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(src, p)
		target := filepath.Join(dst, rel)
		if fi.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		return retry("не удалось скопировать "+rel, func() error { return copyPlain(p, target) })
	})
}

func copyPlain(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}

// replaceDir ставит новую папку на место старой: переименование с повторами, а если не вышло — копирование поверх.
func replaceDir(fresh, target string) error {
	old := target + ".old"
	removeAllRetry(old)
	if fileExists(target) {
		if err := renameRetry(target, old); err != nil {
			// старую папку не отпускают — копируем новые файлы поверх
			if err := copyTree(fresh, target); err != nil {
				return err
			}
			removeAllRetry(fresh)
			return nil
		}
	}
	if err := renameRetry(fresh, target); err != nil {
		if err := copyTree(fresh, target); err != nil {
			return err
		}
		removeAllRetry(fresh)
	}
	go removeAllRetry(old)
	return nil
}

func nodeVersion(node string) (int, int, error) {
	cmd := exec.Command(node, "-v")
	hideWindow(cmd)
	out, err := cmd.Output()
	if err != nil {
		return 0, 0, err
	}
	m := regexp.MustCompile(`v(\d+)\.(\d+)`).FindStringSubmatch(string(out))
	if m == nil {
		return 0, 0, fmt.Errorf("неизвестная версия Node.js: %s", out)
	}
	a, _ := strconv.Atoi(m[1])
	b, _ := strconv.Atoi(m[2])
	return a, b, nil
}

// ensureNode: подходящий Node.js уже есть → ничего не делаем; рядом с установщиком лежит node-v24…-win-x64.zip → берём его
// (установка без интернета); иначе скачиваем официальную сборку и проверяем SHA-256.
func ensureNode(L Layout, report func(string)) error {
	node := L.NodePath()
	need := minNodeMajor
	if os.Getenv("PROMETEY_TEST_NODE") != "" {
		need = 22 // проверка установщика на Linux: CRM работает и на Node.js 22
	}
	if major, _, err := nodeVersion(node); err == nil && major >= need {
		same := len(nodeZip) == 0 || nodeExeSHA256 == "" || os.Getenv("PROMETEY_TEST_NODE") != ""
		if !same {
			sum, _ := fileSHA256(node)
			same = sum == nodeExeSHA256
		}
		if same {
			report("уже установлен")
			return nil
		}
	}
	if os.Getenv("PROMETEY_TEST_NODE") != "" {
		return errors.New("PROMETEY_TEST_NODE указан, но не запускается")
	}
	if err := os.MkdirAll(L.Runtime, 0o755); err != nil {
		return err
	}
	if len(nodeZip) > 0 {
		report("встроенный Node.js, распаковываю")
		if err := installNode(nodeZip, 0, L); err != nil {
			return err
		}
		if nodeExeSHA256 != "" {
			if sum, err := fileSHA256(L.NodePath()); err != nil || sum != nodeExeSHA256 {
				return errors.New("node.exe повреждён при распаковке (контрольная сумма не совпала). Добавьте папку установки в исключения антивируса и запустите установщик ещё раз")
			}
		}
		return checkNode(L, report)
	}
	if runtime.GOOS != "windows" {
		return errors.New("автоматическая загрузка Node.js предусмотрена только для Windows")
	}
	if self, err := os.Executable(); err == nil {
		matches, _ := filepath.Glob(filepath.Join(filepath.Dir(self), "node-v2*-win-x64.zip"))
		for _, z := range matches {
			report("из файла рядом с установщиком: " + filepath.Base(z))
			data, err := os.ReadFile(z)
			if err == nil && extractNode(data, L, report) == nil {
				return nil
			}
		}
	}
	var lastErr error
	for _, base := range nodeMirrors {
		data, name, err := downloadNode(base, report)
		if err != nil {
			lastErr = err
			report("не удалось с " + hostOf(base) + ": " + err.Error())
			continue
		}
		report("проверено (SHA-256), распаковываю " + name)
		return extractNode(data, L, report)
	}
	return fmt.Errorf("не удалось скачать Node.js: %v. Проверьте интернет или положите файл node-v24.x.x-win-x64.zip с nodejs.org рядом с установщиком", lastErr)
}

func hostOf(u string) string {
	u = strings.TrimPrefix(strings.TrimPrefix(u, "https://"), "http://")
	return strings.SplitN(u, "/", 2)[0]
}

func downloadNode(base string, report func(string)) ([]byte, string, error) {
	client := &http.Client{Timeout: 20 * time.Minute}
	report("получаю список файлов с " + hostOf(base))
	sums, err := httpGet(client, base+"SHASUMS256.txt", 1<<20, nil)
	if err != nil {
		return nil, "", err
	}
	m := regexp.MustCompile(`(?m)^([0-9a-f]{64})\s+(node-v24\.\d+\.\d+-win-x64\.zip)\s*$`).FindStringSubmatch(string(sums))
	if m == nil {
		return nil, "", errors.New("в SHASUMS256.txt нет сборки для Windows x64")
	}
	want, name := m[1], m[2]
	data, err := httpGet(client, base+name, 200<<20, func(done, total int64) {
		if total > 0 {
			report(fmt.Sprintf("скачиваю %s — %d%% (%.0f из %.0f МБ)", name, done*100/total, float64(done)/1e6, float64(total)/1e6))
		}
	})
	if err != nil {
		return nil, "", err
	}
	sum := sha256.Sum256(data)
	if hex.EncodeToString(sum[:]) != want {
		return nil, "", errors.New("контрольная сумма не совпала — файл повреждён или подменён")
	}
	return data, name, nil
}

type progressReader struct {
	r           io.Reader
	done, total int64
	last        time.Time
	fn          func(int64, int64)
}

func (p *progressReader) Read(b []byte) (int, error) {
	n, err := p.r.Read(b)
	p.done += int64(n)
	if p.fn != nil && time.Since(p.last) > 400*time.Millisecond {
		p.last = time.Now()
		p.fn(p.done, p.total)
	}
	return n, err
}

func httpGet(client *http.Client, url string, limit int64, progress func(int64, int64)) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
	req.Header.Set("User-Agent", "PrometeyCRM-Setup/"+Version)
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	if resp.ContentLength > limit {
		return nil, errors.New("слишком большой файл")
	}
	pr := &progressReader{r: io.LimitReader(resp.Body, limit+1), total: resp.ContentLength, fn: progress}
	data, err := io.ReadAll(pr)
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, errors.New("слишком большой файл")
	}
	return data, nil
}

// extractNode распаковывает скачанный архив Node.js (в нём одна корневая папка) сразу в runtime\node — без переименования папок.
func extractNode(data []byte, L Layout, report func(string)) error {
	if err := installNode(data, 1, L); err != nil {
		return err
	}
	return checkNode(L, report)
}

func installNode(data []byte, strip int, L Layout) error {
	if err := removeAllRetry(L.NodePath()); err != nil {
		return err
	}
	return unzipTo(data, L.Runtime, strip)
}

func checkNode(L Layout, report func(string)) error {
	var major, minor int
	err := retry("Node.js не запускается", func() error {
		var e error
		major, minor, e = nodeVersion(L.NodePath())
		return e
	})
	if err != nil {
		return fmt.Errorf("%v. Если стоит антивирус (360, Касперский), разрешите ему %s и нажмите «Попробовать ещё раз»", err, L.NodePath())
	}
	if major < minNodeMajor {
		return fmt.Errorf("нужен Node.js %d, а получен %d.%d", minNodeMajor, major, minor)
	}
	report(fmt.Sprintf("Node.js %d.%d готов", major, minor))
	return nil
}

func fileSHA256(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// unzipTo распаковывает ZIP с защитой от выхода за пределы папки (zip-slip); strip — сколько начальных папок отбросить.
func unzipTo(data []byte, dst string, strip int) error {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return fmt.Errorf("архив повреждён: %w", err)
	}
	root, _ := filepath.Abs(dst)
	for _, f := range zr.File {
		name := strings.ReplaceAll(f.Name, "\\", "/")
		parts := strings.Split(strings.Trim(name, "/"), "/")
		if len(parts) <= strip {
			continue
		}
		rel := filepath.Join(parts[strip:]...)
		target := filepath.Join(root, rel)
		if !strings.HasPrefix(target, root+string(os.PathSeparator)) {
			return fmt.Errorf("недопустимый путь в архиве: %s", f.Name)
		}
		if f.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		rc, err := f.Open()
		if err != nil {
			return err
		}
		mode := os.FileMode(0o644)
		if f.Mode()&0o111 != 0 {
			mode = 0o755
		}
		var out *os.File
		if err := retry("не удалось записать "+rel, func() error {
			var e error
			out, e = os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, mode)
			return e
		}); err != nil {
			rc.Close()
			return err
		}
		_, err = io.Copy(out, rc)
		rc.Close()
		if cerr := out.Close(); err == nil {
			err = cerr
		}
		if err != nil {
			return err
		}
	}
	return nil
}
