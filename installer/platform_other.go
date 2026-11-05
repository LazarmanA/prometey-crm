//go:build !windows

package main

// Для проверки установщика на Linux: те же шаги, но без реестра и ярлыков Windows.

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

func infoBox(msg string)  { fmt.Println(msg) }
func fatalBox(msg string) { fmt.Fprintln(os.Stderr, msg); os.Exit(1) }
func defaultBase() string {
	h, _ := os.UserHomeDir()
	return filepath.Join(h, ".local", "share", "Prometey")
}
func hideWindow(cmd *exec.Cmd) {}
func integrate(L Layout, port int) ([]string, error) {
	return nil, nil
}
func allowFirewall(L Layout, port int) error { return nil }

func openBrowser(url string) error {
	fmt.Println("Откройте в браузере:", url)
	return nil
}
func openFolder(path string) { fmt.Println("Папка:", path) }

type pdfEngines struct{ libreoffice, browser string }

func detectPDF() pdfEngines {
	var e pdfEngines
	for _, p := range []string{"/usr/bin/libreoffice", "/usr/local/bin/libreoffice"} {
		if fileExists(p) {
			e.libreoffice = p
			break
		}
	}
	for _, p := range []string{"/usr/bin/chromium", "/usr/bin/google-chrome"} {
		if fileExists(p) {
			e.browser = p
			break
		}
	}
	return e
}
