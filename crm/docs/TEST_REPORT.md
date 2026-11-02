# ПРОМЕТЕЙ CRM 1.0 — Test Report

Release gate: PASS, повторная финальная проверка 2026-10-16.

## Автоматические проверки

- JavaScript syntax: PASS
- Core CRM (45 сценариев): PASS
- SQLite migration/transaction/backup/integrity: PASS
- Company/deal workspaces and RBAC: PASS
- Deal chat / participants / pagination: PASS
- CSV import/export / Unicode / formula escaping / dedup: PASS
- Call journal / private MP3-WAV storage: PASS
- Telephony webhook authorization/idempotence/linking: PASS
- 1C/Bitrix24 integration contract: PASS
- Password hashing / production credential guard: PASS
- Invoice calculations / VAT / atomic numbering: PASS
- Contract/invoice PDF generation: PASS
- Document registry / company/deal summary / payment status: PASS
- Production health / login / logout / session revocation: PASS

## PDF visual review

Реальный счёт был сгенерирован через LibreOffice, отрендерен в PNG и визуально проверен: кириллица отображается, строки таблицы не обрезаны, суммы и подпись читаемы, чёрных квадратов/битых глифов нет.

## Отдельный E2E

Исходные Playwright browser tests сохранены, но Playwright не входит в минимальный runtime. Публичный домен следует дополнительно проверить браузерным E2E после размещения за HTTPS, поскольку именно там проявляются вопросы reverse proxy, cookies и внешних карт/интеграций.

## Финальная перепроверка перед запуском

- `npm run test:release`: дошёл до `PASS PROMETEY CRM 1.0 release gate`.
- Production health: HTTP 200, database=ok, storage=ok, pdfReady=true.
- Полный backup: БД + documents + recordings + manifest — PASS.
- Реальные PDF: A4, счёт 1 стр., договор 2 стр., текст/кириллица извлекаются корректно.
- В текущем изолированном окружении Chromium блокирует loopback `127.0.0.1` политикой организации, поэтому локальный UI smoke не считается повторно подтверждённым здесь. После публикации за HTTPS браузерный E2E обязателен как последний инфраструктурный gate.
