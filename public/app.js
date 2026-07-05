/* Meu Financeiro — lógica do painel */
'use strict';

const $ = (s) => document.querySelector(s);
const money = Charts.money;
const monthLabel = Charts.monthLabel;

const state = {
  month: new Date().toISOString().slice(0, 7),
};

/* ---------- API ---------- */
async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (res.status === 401) { location.href = '/login.html'; throw new Error('não autenticado'); }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'Erro inesperado');
  return body;
}

/* Converte "1.234,56" / "1234,56" / "2.500" / "1234.56" em centavos. */
function parseMoney(str) {
  let s = String(str).trim().replace(/\s|R\$/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  // ponto como separador de milhar sem vírgula: "2.500" → 2500
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

function fullMonthName(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

function fmtDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/* ---------- navegação ---------- */
document.querySelectorAll('.side-nav .nav-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.side-nav .nav-item').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('section.view').forEach((v) => v.classList.remove('active'));
    btn.classList.add('active');
    $('#view-' + btn.dataset.view).classList.add('active');
    refresh(btn.dataset.view);
  });
});

function activeView() {
  return document.querySelector('.side-nav .nav-item.active').dataset.view;
}

/* menu lateral: recolher/expandir (preferência lembrada) */
if (localStorage.getItem('navCollapsed') === '1') document.body.classList.add('nav-collapsed');
$('#btn-collapse').addEventListener('click', () => {
  const collapsed = document.body.classList.toggle('nav-collapsed');
  localStorage.setItem('navCollapsed', collapsed ? '1' : '0');
});

/* ---------- visão geral ---------- */
/* pílula de variação vs mês anterior (▲/▼) */
function deltaHtml(curr, prev, upIsGood) {
  if (prev === 0 && curr === 0) return '';
  if (prev === 0) return '';
  const diff = curr - prev;
  if (diff === 0) return '<span class="delta flat">= igual ao mês anterior</span>';
  const up = diff > 0;
  const good = up === upIsGood;
  const arrow = up ? '▲' : '▼';
  return `<span class="delta ${good ? 'up' : 'down'}">${arrow} ${money(Math.abs(diff))} vs mês anterior</span>`;
}

async function loadOverview() {
  const s = await api(`/api/summary?month=${state.month}`);

  const prev = s.history.length >= 2 ? s.history[s.history.length - 2] : null;
  $('#tile-income').textContent = money(s.income);
  $('#tile-income').className = 'value pos';
  $('#delta-income').innerHTML = prev ? deltaHtml(s.income, prev.income, true) : '';
  $('#tile-expense').textContent = money(s.expense);
  $('#tile-expense').className = 'value neg';
  $('#delta-expense').innerHTML = prev ? deltaHtml(s.expense, prev.expense, false) : '';
  $('#tile-installments').textContent = money(s.installments_due_total);
  $('#tile-installments-hint').textContent = s.installments_due.length
    ? `${s.installments_due.length} parcelamento(s) ativo(s)` : 'nenhuma parcela neste mês';
  $('#tile-balance').textContent = money(s.balance);
  $('#tile-balance').className = 'value ' + (s.balance >= 0 ? 'pos' : 'neg');

  Charts.groupedColumns($('#chart-flow'), s.history, [
    { name: 'Receitas', field: 'income', color: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() },
    { name: 'Despesas', field: 'expense', color: getComputedStyle(document.documentElement).getPropertyValue('--red').trim() },
  ]);
  $('#chart-cat-sub').textContent = fullMonthName(state.month);
  Charts.categoryBars($('#chart-categories'), s.by_category);

  const due = $('#due-list');
  if (!s.installments_due.length) {
    due.innerHTML = '<p class="empty">Nenhuma parcela vence neste mês. 🎉</p>';
  } else {
    due.innerHTML = `<table class="cards">
      <thead><tr><th>Descrição</th><th>Parcela</th><th class="num">Valor</th><th class="num">Faltam</th></tr></thead>
      <tbody>${s.installments_due.map((i) => `
        <tr>
          <td data-label="Descrição">${esc(i.description)}</td>
          <td data-label="Parcela"><span class="badge">${i.paid_installments + 1} de ${i.total_installments}</span></td>
          <td class="num" data-label="Valor">${money(i.installment_cents)}</td>
          <td class="num" data-label="Faltam">${i.remaining}× (${money(i.remaining_cents)})</td>
        </tr>`).join('')}
      </tbody></table>`;
  }

  // gráfico de evolução do saldo
  const w = await api('/api/wealth');
  Charts.wealthChart($('#chart-wealth'), w.months);

  // dívidas em aberto (só aparece se houver alguma)
  const d = await api('/api/debts');
  const debtCard = $('#overview-debts');
  if (d.total_receivable > 0 || d.total_payable > 0) {
    debtCard.hidden = false;
    const parts = [];
    if (d.total_receivable > 0) parts.push(`tem <strong>${money(d.total_receivable)}</strong> a receber`);
    if (d.total_payable > 0) parts.push(`deve <strong>${money(d.total_payable)}</strong> a outras pessoas`);
    $('#overview-debts-text').innerHTML = `Você ${parts.join(' e ')}. Veja os detalhes na aba Dívidas.`;
  } else {
    debtCard.hidden = true;
  }

  // resumo da projeção na visão geral
  const p = await api('/api/projection');
  $('#overview-projection-text').innerHTML = projectionSentence(p);
}

function projectionSentence(p) {
  if (p.active_installments === 0 && p.months_sampled === 0) {
    return 'Registre suas receitas, despesas e parcelas para ver aqui a data em que sua vida financeira vai melhorar.';
  }
  const parts = [];
  if (p.active_installments > 0 && p.debt_free_month) {
    parts.push(`Sua última parcela termina em <strong>${fullMonthName(p.debt_free_month)}</strong> — a partir daí sobram <strong>${money(p.monthly_gain_after_debt)}</strong> por mês.`);
  } else if (p.active_installments === 0) {
    parts.push(`Você não tem parcelas pendentes — sua sobra estimada é de <strong>${money(p.monthly_gain_after_debt)}</strong> por mês.`);
  }
  if (p.first_positive_month) {
    parts.push(`Primeiro mês projetado com sobra positiva: <strong>${fullMonthName(p.first_positive_month)}</strong>.`);
  } else if (p.months_sampled > 0) {
    parts.push('Com a média atual, nenhum mês projetado fecha positivo — reveja as despesas para virar o jogo.');
  }
  return parts.join(' ');
}

/* ---------- lançamentos ---------- */
async function loadTransactions() {
  const rows = await api(`/api/transactions?month=${state.month}`);
  const box = $('#tx-list');
  if (!rows.length) {
    box.innerHTML = `<p class="empty">Nenhum lançamento em ${fullMonthName(state.month)}. Adicione o primeiro acima.</p>`;
    return;
  }
  box.innerHTML = `<table class="cards">
    <thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th class="num">Valor</th><th></th></tr></thead>
    <tbody>${rows.map((t) => `
      <tr>
        <td data-label="Data">${fmtDate(t.date)}</td>
        <td data-label="Descrição">${esc(t.description)}${t.recurring ? ' <span class="badge">fixo</span>' : ''}</td>
        <td data-label="Categoria">${esc(t.category)}</td>
        <td class="num ${t.type === 'receita' ? 'amount-pos' : 'amount-neg'}" data-label="Valor">${t.type === 'receita' ? '+' : '−'} ${money(t.amount_cents)}</td>
        <td class="num actions"><button class="btn ghost small" data-del-tx="${t.id}">Excluir</button></td>
      </tr>`).join('')}
    </tbody></table>`;
  box.querySelectorAll('[data-del-tx]').forEach((b) => {
    b.onclick = async () => {
      if (!confirm('Excluir este lançamento?')) return;
      await api(`/api/transactions/${b.dataset.delTx}`, { method: 'DELETE' });
      loadTransactions();
    };
  });
}

$('#form-tx').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const cents = parseMoney(f.amount.value);
  if (!cents) { alert('Informe um valor válido, ex.: 1.250,00'); return; }
  await api('/api/transactions', {
    method: 'POST',
    body: JSON.stringify({
      type: f.type.value,
      description: f.description.value,
      category: f.category.value || 'Outros',
      amount_cents: cents,
      date: f.date.value,
      recurring: f.recurring.checked,
    }),
  });
  f.reset();
  f.date.value = defaultDate();
  state.month = f.date.value.slice(0, 7);
  syncMonthPickers();
  loadTransactions();
});

/* ---------- parcelas ---------- */
async function loadInstallments() {
  const rows = await api('/api/installments');
  const box = $('#inst-list');
  if (!rows.length) {
    box.innerHTML = '<p class="empty">Nenhum parcelamento cadastrado. Adicione compras parceladas, financiamentos ou empréstimos acima.</p>';
    return;
  }
  box.innerHTML = `<table class="cards">
    <thead><tr>
      <th>Descrição</th><th class="num">Parcela</th><th>Pagas</th>
      <th class="num">Falta pagar</th><th>Próxima</th><th>Termina em</th><th></th>
    </tr></thead>
    <tbody>${rows.map((i) => {
      const done = i.remaining <= 0;
      return `<tr>
        <td data-label="Descrição">${esc(i.description)} <span class="badge">${esc(i.category)}</span></td>
        <td class="num" data-label="Parcela">${money(i.installment_cents)}</td>
        <td data-label="Pagas">${i.paid_installments} de ${i.total_installments}</td>
        <td class="num" data-label="Falta pagar">${done ? '<span class="amount-pos">Quitado ✓</span>' : `${i.remaining}× (${money(i.remaining_cents)})`}</td>
        <td data-label="Próxima">${done ? '—' : monthLabel(i.next_due_month)}</td>
        <td data-label="Termina em">${done ? '—' : monthLabel(i.last_due_month)}</td>
        <td class="num actions" style="white-space:nowrap">
          ${done ? '' : `<button class="btn small" data-pay="${i.id}">Pagar parcela</button>`}
          ${i.paid_installments > 0 ? `<button class="btn ghost small" data-unpay="${i.id}" title="Desfazer pagamento">↩</button>` : ''}
          <button class="btn danger-ghost small" data-del-inst="${i.id}">Excluir</button>
        </td>
      </tr>`;
    }).join('')}
    </tbody></table>`;

  box.querySelectorAll('[data-pay]').forEach((b) => {
    b.onclick = async () => { await api(`/api/installments/${b.dataset.pay}/pay`, { method: 'POST' }); loadInstallments(); };
  });
  box.querySelectorAll('[data-unpay]').forEach((b) => {
    b.onclick = async () => { await api(`/api/installments/${b.dataset.unpay}/unpay`, { method: 'POST' }); loadInstallments(); };
  });
  box.querySelectorAll('[data-del-inst]').forEach((b) => {
    b.onclick = async () => {
      if (!confirm('Excluir este parcelamento?')) return;
      await api(`/api/installments/${b.dataset.delInst}`, { method: 'DELETE' });
      loadInstallments();
    };
  });
}

$('#form-inst').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const cents = parseMoney(f.installment.value);
  if (!cents) { alert('Informe o valor da parcela, ex.: 350,00'); return; }
  await api('/api/installments', {
    method: 'POST',
    body: JSON.stringify({
      description: f.description.value,
      category: f.category.value || 'Outros',
      installment_cents: cents,
      total_installments: Number(f.total.value),
      paid_installments: Number(f.paid.value || 0),
      next_due_date: f.next_due.value,
    }),
  });
  f.reset();
  f.paid.value = 0;
  f.next_due.value = defaultDate();
  loadInstallments();
});

/* ---------- dívidas ---------- */
async function loadDebts() {
  const d = await api('/api/debts');
  $('#debt-receivable').textContent = money(d.total_receivable);
  $('#debt-payable').textContent = money(d.total_payable);

  const box = $('#debt-list');
  if (!d.items.length) {
    box.innerHTML = '<p class="empty">Nenhuma dívida anotada. Registre acima quem te deve ou a quem você deve.</p>';
    return;
  }
  box.innerHTML = `<table class="cards">
    <thead><tr><th>Tipo</th><th>Pessoa</th><th>Motivo</th><th class="num">Valor</th><th>Combinado para</th><th>Situação</th><th></th></tr></thead>
    <tbody>${d.items.map((i) => `
      <tr style="${i.paid ? 'opacity:.55' : ''}">
        <td data-label="Tipo"><span class="badge">${i.direction === 'a_receber' ? '↙ me devem' : '↗ eu devo'}</span></td>
        <td data-label="Pessoa">${esc(i.person)}</td>
        <td data-label="Motivo">${esc(i.description) || '—'}</td>
        <td class="num ${i.direction === 'a_receber' ? 'amount-pos' : 'amount-neg'}" data-label="Valor">${money(i.amount_cents)}</td>
        <td data-label="Combinado para">${i.due_date ? fmtDate(i.due_date) : '—'}</td>
        <td data-label="Situação">${i.paid ? '<span class="amount-pos">Quitada ✓</span>' : 'Em aberto'}</td>
        <td class="num actions" style="white-space:nowrap">
          <button class="btn ${i.paid ? 'ghost' : ''} small" data-toggle-debt="${i.id}">${i.paid ? 'Reabrir' : 'Marcar quitada'}</button>
          <button class="btn danger-ghost small" data-del-debt="${i.id}">Excluir</button>
        </td>
      </tr>`).join('')}
    </tbody></table>`;

  box.querySelectorAll('[data-toggle-debt]').forEach((b) => {
    b.onclick = async () => { await api(`/api/debts/${b.dataset.toggleDebt}/toggle`, { method: 'POST' }); loadDebts(); };
  });
  box.querySelectorAll('[data-del-debt]').forEach((b) => {
    b.onclick = async () => {
      if (!confirm('Excluir esta dívida?')) return;
      await api(`/api/debts/${b.dataset.delDebt}`, { method: 'DELETE' });
      loadDebts();
    };
  });
}

$('#form-debt').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const cents = parseMoney(f.amount.value);
  if (!cents) { alert('Informe um valor válido, ex.: 200,00'); return; }
  await api('/api/debts', {
    method: 'POST',
    body: JSON.stringify({
      direction: f.direction.value,
      person: f.person.value,
      description: f.description.value,
      amount_cents: cents,
      due_date: f.due_date.value || null,
    }),
  });
  f.reset();
  loadDebts();
});

/* ---------- projeção ---------- */
async function loadProjection() {
  const p = await api('/api/projection');
  $('#projection-text').innerHTML = projectionSentence(p);
  $('#proj-income').textContent = money(p.base_income);
  $('#proj-income').className = 'value pos';
  $('#proj-expense').textContent = money(p.base_expense);
  $('#proj-expense').className = 'value neg';
  $('#proj-sample').textContent = p.months_sampled
    ? `média dos últimos ${p.months_sampled} mês(es) com lançamentos` : 'sem lançamentos ainda';
  $('#proj-debt').textContent = money(p.total_debt);
  $('#proj-debt-hint').textContent = p.active_installments
    ? `${p.active_installments} parcelamento(s) ativo(s)` : 'nenhum parcelamento ativo';
  const gain = $('#proj-gain');
  gain.textContent = money(p.monthly_gain_after_debt);
  gain.className = 'value ' + (p.monthly_gain_after_debt >= 0 ? 'pos' : 'neg');

  Charts.projectionChart($('#chart-projection'), p.months);
}

/* ---------- utilidades ---------- */
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function defaultDate() {
  return new Date().toISOString().slice(0, 10);
}

function syncMonthPickers() {
  $('#month-picker').value = state.month;
  $('#tx-month-picker').value = state.month;
}

function refresh(view = activeView()) {
  if (view === 'overview') loadOverview().catch(showError);
  if (view === 'transactions') loadTransactions().catch(showError);
  if (view === 'installments') loadInstallments().catch(showError);
  if (view === 'debts') loadDebts().catch(showError);
  if (view === 'projection') loadProjection().catch(showError);
}

function showError(err) {
  if (err.message !== 'não autenticado') console.error(err);
}

$('#month-picker').addEventListener('change', (e) => {
  if (!e.target.value) return;
  state.month = e.target.value;
  syncMonthPickers();
  refresh();
});
$('#tx-month-picker').addEventListener('change', (e) => {
  if (!e.target.value) return;
  state.month = e.target.value;
  syncMonthPickers();
  refresh();
});

document.querySelectorAll('.js-logout').forEach((b) => {
  b.addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    location.href = '/login.html';
  });
});

/* ---------- inicialização ---------- */
(async function init() {
  try {
    const me = await api('/api/me');
    $('#user-name').textContent = `Olá, ${me.name.split(' ')[0]}`;
  } catch { return; }
  syncMonthPickers();
  document.querySelector('#form-tx [name=date]').value = defaultDate();
  document.querySelector('#form-inst [name=next_due]').value = defaultDate();
  refresh('overview');
})();
