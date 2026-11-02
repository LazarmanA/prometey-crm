# ПРОМЕТЕЙ CRM 1.0 — Release Notes

Дата релиз-кандидата: 2026-10-16.

## Основа

Релиз основан на последней серверной версии 0.10.0, а не на более ранней HTML-версии 0.9.

## Добавлено к 0.10

- безопасная production-авторизация с scrypt;
- постоянные серверные сессии и HttpOnly cookie;
- блокировка демо-учётных данных в production;
- rate limit входа;
- модуль «Документы»;
- уникальная транзакционная нумерация счетов и договоров;
- расчёт НДС 0/5/7/10/20%;
- счета по плану и по фактическим сменам;
- переработка отдельной строкой счёта и в фактической экономике;
- PDF через LibreOffice с кириллицей;
- реестр документов и статусы оплаты;
- документы в рабочих столах компании и сделки;
- health-check БД/хранилища/PDF;
- graceful shutdown;
- полное резервное копирование БД + PDF + аудио;
- Docker-контур Node.js 24;
- единый release gate.

## Проверки релиз-кандидата

Пройдено без ошибок:

- 45 core CRM checks;
- database migration/rollback/backup/integrity;
- workspaces/RBAC;
- deal chat + CSV contacts;
- calls + private audio;
- telephony gateway;
- 1C/Bitrix integration contract;
- security tests;
- invoice/contract/VAT/numbering/PDF tests;
- production health/login/logout runtime smoke;
- визуальная проверка PDF-счёта с кириллицей и таблицей.

## Миграция

Рабочие данные старых версий сохраняются: SQLite-хранилище автоматически добавляет новые коллекции при отсутствии. Перед обновлением обязательна полная резервная копия.
