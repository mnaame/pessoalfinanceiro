'use strict';
const db = require('./db');
const auth = require('./auth');

/* ---------- utilidades ---------- */

function json(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 1e6) { reject(new Error('payload muito grande')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); }
      catch { reject(new Error('JSON inválido')); }
    });
    req.on('error', reject);
  });
}

// Meses como índice absoluto (ano*12+mês) para aritmética de datas.
function monthIndex(isoDate) {
  const [y, m] = isoDate.split('-').map(Number);
  return y * 12 + (m - 1);
}
function indexToMonth(idx) {
  const y = Math.floor(idx / 12);
  const m = (idx % 12) + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}
function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function isValidMonth(s) { return /^\d{4}-\d{2}$/.test(s); }
function isValidDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s); }

function cleanText(value, max = 120) {
  return String(value ?? '').trim().slice(0, max);
}

function toCents(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

/* ---------- transações ---------- */

function listTransactions(userId, month) {
  return db.prepare(`
    SELECT id, type, description, category, amount_cents, date, recurring
    FROM transactions
    WHERE user_id = ? AND substr(date, 1, 7) = ?
    ORDER BY date DESC, id DESC
  `).all(userId, month);
}

function monthTotals(userId, month) {
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN type = 'receita' THEN amount_cents END), 0) AS income,
      COALESCE(SUM(CASE WHEN type = 'despesa' THEN amount_cents END), 0) AS expense
    FROM transactions
    WHERE user_id = ? AND substr(date, 1, 7) = ?
  `).get(userId, month);
  return { income: Number(row.income), expense: Number(row.expense) };
}

/* ---------- parcelas ---------- */

function listInstallments(userId) {
  const rows = db.prepare(`
    SELECT id, description, category, installment_cents, total_installments,
           paid_installments, first_due_date
    FROM installments WHERE user_id = ? ORDER BY id DESC
  `).all(userId);
  const nowIdx = monthIndex(currentMonth() + '-01');
  return rows.map((r) => {
    const remaining = r.total_installments - r.paid_installments;
    // Mês da próxima parcela: 1º vencimento + parcelas pagas (nunca antes do mês atual).
    const nextIdx = Math.max(monthIndex(r.first_due_date) + r.paid_installments, nowIdx);
    return {
      ...r,
      remaining,
      remaining_cents: remaining * r.installment_cents,
      next_due_month: remaining > 0 ? indexToMonth(nextIdx) : null,
      last_due_month: remaining > 0 ? indexToMonth(nextIdx + remaining - 1) : null,
    };
  });
}

// Parcelas com vencimento em um dado mês (para o resumo mensal).
function installmentsDueIn(userId, month) {
  const target = monthIndex(month + '-01');
  return listInstallments(userId).filter((inst) => {
    if (inst.remaining <= 0) return false;
    const first = monthIndex(inst.next_due_month + '-01');
    const last = monthIndex(inst.last_due_month + '-01');
    return target >= first && target <= last;
  });
}

/* ---------- projeção financeira ---------- */

function buildProjection(userId) {
  const nowIdx = monthIndex(currentMonth() + '-01');

  // Média de receitas/despesas dos últimos 3 meses com lançamentos.
  const monthsWithData = db.prepare(`
    SELECT substr(date, 1, 7) AS month,
      COALESCE(SUM(CASE WHEN type = 'receita' THEN amount_cents END), 0) AS income,
      COALESCE(SUM(CASE WHEN type = 'despesa' THEN amount_cents END), 0) AS expense
    FROM transactions WHERE user_id = ?
    GROUP BY month ORDER BY month DESC LIMIT 3
  `).all(userId);

  const n = monthsWithData.length || 1;
  const baseIncome = Math.round(monthsWithData.reduce((s, r) => s + Number(r.income), 0) / n);
  const baseExpense = Math.round(monthsWithData.reduce((s, r) => s + Number(r.expense), 0) / n);

  const installments = listInstallments(userId).filter((i) => i.remaining > 0);
  const totalDebt = installments.reduce((s, i) => s + i.remaining_cents, 0);

  let lastLoadIdx = nowIdx - 1;
  for (const inst of installments) {
    lastLoadIdx = Math.max(lastLoadIdx, monthIndex(inst.last_due_month + '-01'));
  }
  const horizon = Math.max(lastLoadIdx - nowIdx + 4, 12); // pelo menos 12 meses

  const months = [];
  let cumulative = 0;
  for (let k = 0; k < horizon; k++) {
    const idx = nowIdx + k;
    let load = 0;
    for (const inst of installments) {
      const first = monthIndex(inst.next_due_month + '-01');
      const last = monthIndex(inst.last_due_month + '-01');
      if (idx >= first && idx <= last) load += inst.installment_cents;
    }
    const leftover = baseIncome - baseExpense - load;
    cumulative += leftover;
    months.push({ month: indexToMonth(idx), load, leftover, cumulative });
  }

  const firstPositive = months.find((m) => m.leftover > 0);

  return {
    base_income: baseIncome,
    base_expense: baseExpense,
    months_sampled: monthsWithData.length,
    total_debt: totalDebt,
    active_installments: installments.length,
    debt_free_month: installments.length ? (months.find((m) => m.load === 0)?.month ?? null) : null,
    first_positive_month: firstPositive ? firstPositive.month : null,
    monthly_gain_after_debt: baseIncome - baseExpense,
    months,
  };
}

/* ---------- rotas ---------- */

async function handleApi(req, res, url) {
  const { pathname } = url;
  const method = req.method;

  /* --- autenticação --- */
  if (method === 'POST' && pathname === '/api/register') {
    const body = await readBody(req);
    const name = cleanText(body.name, 60);
    const email = cleanText(body.email, 120).toLowerCase();
    const password = String(body.password ?? '');
    if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(res, 400, { error: 'Informe nome e um e-mail válido.' });
    if (password.length < 8) return json(res, 400, { error: 'A senha precisa ter pelo menos 8 caracteres.' });
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
      return json(res, 409, { error: 'Este e-mail já está cadastrado. Faça login.' });
    }
    const info = db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)')
      .run(name, email, auth.hashPassword(password));
    const token = auth.createSession(Number(info.lastInsertRowid));
    return json(res, 201, { name, email }, { 'Set-Cookie': auth.sessionCookie(token) });
  }

  if (method === 'POST' && pathname === '/api/login') {
    const body = await readBody(req);
    const email = cleanText(body.email, 120).toLowerCase();
    const user = db.prepare('SELECT id, name, email, password_hash FROM users WHERE email = ?').get(email);
    if (!user || !auth.verifyPassword(String(body.password ?? ''), user.password_hash)) {
      return json(res, 401, { error: 'E-mail ou senha incorretos.' });
    }
    const token = auth.createSession(user.id);
    return json(res, 200, { name: user.name, email: user.email }, { 'Set-Cookie': auth.sessionCookie(token) });
  }

  if (method === 'POST' && pathname === '/api/logout') {
    auth.destroySession(auth.parseCookies(req).session);
    return json(res, 200, { ok: true }, { 'Set-Cookie': auth.clearCookie() });
  }

  /* --- daqui para baixo exige login --- */
  const user = auth.getUser(req);
  if (!user) return json(res, 401, { error: 'Não autenticado.' });

  if (method === 'GET' && pathname === '/api/me') return json(res, 200, user);

  /* --- transações --- */
  if (method === 'GET' && pathname === '/api/transactions') {
    const month = url.searchParams.get('month') || currentMonth();
    if (!isValidMonth(month)) return json(res, 400, { error: 'Mês inválido.' });
    return json(res, 200, listTransactions(user.id, month));
  }

  if (method === 'POST' && pathname === '/api/transactions') {
    const b = await readBody(req);
    const type = b.type === 'receita' ? 'receita' : b.type === 'despesa' ? 'despesa' : null;
    const description = cleanText(b.description);
    const category = cleanText(b.category, 40) || 'Outros';
    const amount = toCents(b.amount_cents);
    const date = cleanText(b.date, 10);
    if (!type || !description || !amount || !isValidDate(date)) {
      return json(res, 400, { error: 'Preencha tipo, descrição, valor e data.' });
    }
    const info = db.prepare(`
      INSERT INTO transactions (user_id, type, description, category, amount_cents, date, recurring)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(user.id, type, description, category, amount, date, b.recurring ? 1 : 0);
    return json(res, 201, { id: Number(info.lastInsertRowid) });
  }

  let m = pathname.match(/^\/api\/transactions\/(\d+)$/);
  if (m && method === 'DELETE') {
    db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').run(Number(m[1]), user.id);
    return json(res, 200, { ok: true });
  }

  /* --- parcelas --- */
  if (method === 'GET' && pathname === '/api/installments') {
    return json(res, 200, listInstallments(user.id));
  }

  if (method === 'POST' && pathname === '/api/installments') {
    const b = await readBody(req);
    const description = cleanText(b.description);
    const category = cleanText(b.category, 40) || 'Outros';
    const value = toCents(b.installment_cents);
    const total = Number(b.total_installments);
    const paid = Number(b.paid_installments ?? 0);
    if (!description || !value || !Number.isInteger(total) || total < 1 || total > 480) {
      return json(res, 400, { error: 'Preencha descrição, valor da parcela e quantidade de parcelas.' });
    }
    if (!Number.isInteger(paid) || paid < 0 || paid > total) {
      return json(res, 400, { error: 'Parcelas pagas deve estar entre 0 e o total.' });
    }
    // O formulário informa quando vence a PRÓXIMA parcela; o 1º vencimento é
    // recuado "paid" meses para o cronograma restante começar nessa data.
    let firstDue = cleanText(b.first_due_date, 10);
    const nextDue = cleanText(b.next_due_date, 10);
    if (nextDue) {
      if (!isValidDate(nextDue)) return json(res, 400, { error: 'Data da próxima parcela inválida.' });
      const day = Math.min(Number(nextDue.slice(8, 10)), 28);
      firstDue = `${indexToMonth(monthIndex(nextDue) - paid)}-${String(day).padStart(2, '0')}`;
    }
    if (!isValidDate(firstDue)) {
      return json(res, 400, { error: 'Informe quando vence a próxima parcela.' });
    }
    const info = db.prepare(`
      INSERT INTO installments (user_id, description, category, installment_cents, total_installments, paid_installments, first_due_date)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(user.id, description, category, value, total, paid, firstDue);
    return json(res, 201, { id: Number(info.lastInsertRowid) });
  }

  m = pathname.match(/^\/api\/installments\/(\d+)\/(pay|unpay)$/);
  if (m && method === 'POST') {
    const delta = m[2] === 'pay' ? 1 : -1;
    db.prepare(`
      UPDATE installments
      SET paid_installments = MIN(MAX(paid_installments + ?, 0), total_installments)
      WHERE id = ? AND user_id = ?
    `).run(delta, Number(m[1]), user.id);
    return json(res, 200, { ok: true });
  }

  m = pathname.match(/^\/api\/installments\/(\d+)$/);
  if (m && method === 'DELETE') {
    db.prepare('DELETE FROM installments WHERE id = ? AND user_id = ?').run(Number(m[1]), user.id);
    return json(res, 200, { ok: true });
  }

  /* --- resumo do mês --- */
  if (method === 'GET' && pathname === '/api/summary') {
    const month = url.searchParams.get('month') || currentMonth();
    if (!isValidMonth(month)) return json(res, 400, { error: 'Mês inválido.' });

    const totals = monthTotals(user.id, month);
    const due = installmentsDueIn(user.id, month);
    const dueTotal = due.reduce((s, i) => s + i.installment_cents, 0);

    const history = [];
    const baseIdx = monthIndex(month + '-01');
    for (let k = 5; k >= 0; k--) {
      const mo = indexToMonth(baseIdx - k);
      history.push({ month: mo, ...monthTotals(user.id, mo) });
    }

    const byCategory = db.prepare(`
      SELECT category, SUM(amount_cents) AS total
      FROM transactions
      WHERE user_id = ? AND type = 'despesa' AND substr(date, 1, 7) = ?
      GROUP BY category ORDER BY total DESC
    `).all(user.id, month).map((r) => ({ category: r.category, total: Number(r.total) }));

    return json(res, 200, {
      month,
      income: totals.income,
      expense: totals.expense,
      balance: totals.income - totals.expense - dueTotal,
      installments_due: due,
      installments_due_total: dueTotal,
      history,
      by_category: byCategory,
    });
  }

  /* --- projeção --- */
  if (method === 'GET' && pathname === '/api/projection') {
    return json(res, 200, buildProjection(user.id));
  }

  return json(res, 404, { error: 'Rota não encontrada.' });
}

module.exports = { handleApi };
