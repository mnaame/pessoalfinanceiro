'use strict';
// Banco de dados SQLite embutido no Node (node:sqlite) — nenhuma dependência externa.
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'financeiro.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type         TEXT NOT NULL CHECK (type IN ('receita', 'despesa')),
    description  TEXT NOT NULL,
    category     TEXT NOT NULL DEFAULT 'Outros',
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    date         TEXT NOT NULL, -- YYYY-MM-DD
    recurring    INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_tx_user_date ON transactions(user_id, date);

  CREATE TABLE IF NOT EXISTS installments (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    description        TEXT NOT NULL,
    category           TEXT NOT NULL DEFAULT 'Outros',
    installment_cents  INTEGER NOT NULL CHECK (installment_cents > 0),
    total_installments INTEGER NOT NULL CHECK (total_installments > 0),
    paid_installments  INTEGER NOT NULL DEFAULT 0,
    first_due_date     TEXT NOT NULL -- YYYY-MM-DD da 1ª parcela
  );

  CREATE INDEX IF NOT EXISTS idx_inst_user ON installments(user_id);

  CREATE TABLE IF NOT EXISTS debts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    direction    TEXT NOT NULL CHECK (direction IN ('a_receber', 'a_pagar')),
    person       TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    due_date     TEXT,                     -- data combinada (opcional)
    paid         INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL DEFAULT (date('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_debts_user ON debts(user_id);

  CREATE TABLE IF NOT EXISTS goals (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    target_cents INTEGER NOT NULL CHECK (target_cents > 0),
    saved_cents  INTEGER NOT NULL DEFAULT 0,
    target_date  TEXT,                    -- opcional (YYYY-MM-DD)
    created_at   TEXT NOT NULL DEFAULT (date('now'))
  );

  CREATE TABLE IF NOT EXISTS budgets (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category    TEXT NOT NULL,
    limit_cents INTEGER NOT NULL CHECK (limit_cents > 0),
    UNIQUE (user_id, category)
  );
`);

module.exports = db;
