package main

import (
	"fmt"
	"net"
	"strings"
)

// Доступ из офисной сети: CRM слушает все адреса компьютера, брандмауэр Windows пропускает к ней
// только компьютеры локальной сети (правило «PrometeyCRM» для node.exe).

const firewallRule = "PrometeyCRM"

// firewallCommands — команды netsh: убрать старые правила для node.exe (в том числе «Блокировать»,
// которые Windows создаёт, если в её окне нажали «Отмена»), затем разрешить вход из локальной сети.
func firewallCommands(node string, port int) string {
	return strings.Join([]string{
		fmt.Sprintf(`netsh advfirewall firewall delete rule name="%s" >nul 2>&1`, firewallRule),
		fmt.Sprintf(`netsh advfirewall firewall delete rule name=all program="%s" >nul 2>&1`, node),
		fmt.Sprintf(`netsh advfirewall firewall add rule name="%s" dir=in action=allow program="%s" protocol=TCP localport=%d remoteip=localsubnet,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16 profile=any`, firewallRule, node, port),
	}, " & ")
}

// lanIPs — адреса компьютера в офисной сети (10.x, 172.16–31.x, 192.168.x).
func lanIPs() []string {
	var out []string
	ifaces, _ := net.Interfaces()
	for _, i := range ifaces {
		if i.Flags&net.FlagUp == 0 || i.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, _ := i.Addrs()
		for _, a := range addrs {
			ipn, ok := a.(*net.IPNet)
			if !ok {
				continue
			}
			ip := ipn.IP.To4()
			if ip != nil && ip.IsPrivate() && !strings.HasPrefix(ip.String(), "169.254.") {
				out = append(out, ip.String())
			}
		}
	}
	return out
}
