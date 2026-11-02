# ПРОМЕТЕЙ CRM

Отраслевая CRM для аренды и субаренды спецтехники: лиды (в том числе с Авито), компании, объекты, сделки с несколькими машинами,
своя и наёмная техника, смены, карта, финансы, документы (счета, договоры, свои шаблоны Word, УПД 5.03 для ЭДО), бухгалтерия,
лента, роли и права, телефония, интеграции с 1С и Битрикс24, подписка и пульт продавца.

| Папка | Что внутри |
|---|---|
| [`crm/`](crm) | Сама CRM: Node.js 22+ без внешних зависимостей, база SQLite (`node:sqlite`). Запуск: `cd crm && npm start` → http://127.0.0.1:3030 |
| [`installer/`](installer) | Установщик для Windows (Go): `PrometeyCRM-Setup-<версия>.exe`, установка в один щелчок без прав администратора |
| [`vendor/`](vendor) | Пульт продавца: все установки CRM, подписки и оплаты, состояние сервисов, пользователи |
| [`deploy/`](deploy) | Установка CRM на сервер Linux (nginx, HTTPS, systemd) |

## Быстрый старт (разработка)
```
cd crm
npm start            # демо: director@prometey.local / director
npm run test:full    # все проверки (нужен Chromium для UI-тестов)
```

## Сборка установщика Windows
```
cd installer
NODE_EXE=/путь/к/node.exe CRM=../crm ./build.sh
# с подключением к пульту продавца:
LICENSE_SERVER=https://pult.example.ru LICENSE_KEY=<ключ> NODE_EXE=... CRM=../crm ./build.sh
```
Нужны Go 1.22+ и Python 3. Готовый файл — `installer/dist/`. Сами `.exe` в репозиторий не кладутся (≈42 МБ) —
выкладывайте их в «Releases».

## Пульт продавца
См. [`vendor/README.md`](vendor/README.md): установка на сервер — `sudo bash vendor/deploy/install-vendor.sh ДОМЕН EMAIL`.

## Что не хранится в репозитории
Базы данных, документы, резервные копии, ключи Авито, файл подписки и закрытый ключ пульта (`vendor/data/license-signing-key.pem`)
исключены через `.gitignore`. Пароли задаются через переменные окружения, не в коде.

История изменений — [`crm/CHANGELOG.md`](crm/CHANGELOG.md).

© ПРОМЕТЕЙ. Все права защищены.
