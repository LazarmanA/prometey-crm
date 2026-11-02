package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

type uiOptions struct {
	noBrowser bool
	port      int
}

// serveUI показывает ход установки в браузере. Установка начинается сама, как только окно открылось.
// Страница доступна только с этого компьютера (127.0.0.1), с одноразовым ключом и проверкой Host.
func serveUI(L Layout, opt uiOptions) {
	tokenBytes := make([]byte, 16)
	rand.Read(tokenBytes)
	token := hex.EncodeToString(tokenBytes)
	ln, err := net.Listen("tcp", "127.0.0.1:"+strconv.Itoa(opt.port))
	if err != nil {
		fatalBox("Не удалось открыть окно установки: " + err.Error())
	}
	port := ln.Addr().(*net.TCPAddr).Port
	host := "127.0.0.1:" + strconv.Itoa(port)
	url := fmt.Sprintf("http://%s/?t=%s", host, token)

	var (
		mu       sync.Mutex
		progress *Progress
		lastPing = time.Now()
		quit     = make(chan struct{}, 1)
	)
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Security-Policy", "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src data:; form-action 'none'; frame-ancestors 'none'; base-uri 'none'")
		html := strings.ReplaceAll(setupHTML, "{{VERSION}}", Version)
		w.Write([]byte(strings.ReplaceAll(html, "{{TOKEN}}", token)))
	})
	api := func(path string, h func(w http.ResponseWriter, r *http.Request)) {
		mux.HandleFunc(path, func(w http.ResponseWriter, r *http.Request) {
			if r.Host != host || r.Header.Get("X-Token") != token {
				http.Error(w, "forbidden", http.StatusForbidden)
				return
			}
			mu.Lock()
			lastPing = time.Now()
			mu.Unlock()
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.Header().Set("Cache-Control", "no-store")
			h(w, r)
		})
	}
	reply := func(w http.ResponseWriter, v any) { json.NewEncoder(w).Encode(v) }
	fail := func(w http.ResponseWriter, msg string) { w.WriteHeader(400); reply(w, map[string]string{"error": msg}) }

	api("/api/ping", func(w http.ResponseWriter, r *http.Request) { reply(w, map[string]bool{"ok": true}) })
	api("/api/quit", func(w http.ResponseWriter, r *http.Request) {
		reply(w, map[string]bool{"ok": true})
		quit <- struct{}{}
	})
	api("/api/open", func(w http.ResponseWriter, r *http.Request) {
		var b struct{ URL, Folder string }
		json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&b)
		if strings.HasPrefix(b.URL, "http://localhost:") || strings.HasPrefix(b.URL, "https://www.libreoffice.org/") {
			openBrowser(b.URL)
		}
		if b.Folder == "data" {
			openFolder(L.Data)
		}
		reply(w, map[string]bool{"ok": true})
	})
	api("/api/state", func(w http.ResponseWriter, r *http.Request) {
		info, _ := readInfo(L)
		reply(w, map[string]any{"version": Version, "existing": info, "base": L.Base})
	})
	api("/api/install", func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		if progress != nil && !progress.Done {
			reply(w, map[string]bool{"ok": true}) // уже идёт
			return
		}
		progress = newProgress(installSteps...)
		go install(L, progress)
		reply(w, map[string]bool{"ok": true})
	})
	api("/api/progress", func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		p := progress
		mu.Unlock()
		if p == nil {
			reply(w, map[string]any{"steps": []Step{}})
			return
		}
		w.Write(p.snapshot())
	})
	api("/api/reset-password", func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		busy := progress != nil && !progress.Done
		mu.Unlock()
		if busy {
			fail(w, "дождитесь окончания установки")
			return
		}
		email, pass, err := resetAdminPassword(L)
		if err != nil {
			fail(w, err.Error())
			return
		}
		reply(w, map[string]string{"login": email, "password": pass})
	})

	srv := &http.Server{Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	go srv.Serve(ln)
	fmt.Println(productName+" "+Version+" — окно установки:", url)
	if !opt.noBrowser {
		if err := openBrowser(url); err != nil {
			go infoBox("Откройте в браузере адрес:\n\n" + url)
		}
	}
	// Закрывается само через 3 минуты после закрытия вкладки (но никогда — во время установки).
	tick := time.NewTicker(5 * time.Second)
	for {
		select {
		case <-quit:
			time.Sleep(300 * time.Millisecond)
			return
		case <-tick.C:
			mu.Lock()
			busy := progress != nil && !progress.Done
			idle := time.Since(lastPing)
			mu.Unlock()
			if !busy && idle > 3*time.Minute {
				return
			}
		}
	}
}
