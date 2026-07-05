/* Meu Financeiro — lógica do painel */
'use strict';

// aplica o tema salvo o quanto antes para não piscar
{
  const t = localStorage.getItem('theme');
  if (t && t !== 'auto') document.documentElement.dataset.theme = t;
}

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
let txCache = [];
let txEditingId = null;

function renderTransactions() {
  const q = $('#tx-search').value.trim().toLowerCase();
  const type = $('#tx-filter-type').value;
  const rows = txCache.filter((t) =>
    (!type || t.type === type) &&
    (!q || t.description.toLowerCase().includes(q) || t.category.toLowerCase().includes(q)));
  const box = $('#tx-list');
  if (!rows.length) {
    box.innerHTML = txCache.length
      ? '<p class="empty">Nada encontrado com esse filtro.</p>'
      : `<p class="empty">Nenhum lançamento em ${fullMonthName(state.month)}. Adicione o primeiro acima.</p>`;
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
        <td class="num actions">
          <button class="btn ghost small" data-edit-tx="${t.id}">Editar</button>
          <button class="btn danger-ghost small" data-del-tx="${t.id}">Excluir</button>
        </td>
      </tr>`).join('')}
    </tbody></table>`;
  box.querySelectorAll('[data-del-tx]').forEach((b) => {
    b.onclick = async () => {
      if (!confirm('Excluir este lançamento?')) return;
      await api(`/api/transactions/${b.dataset.delTx}`, { method: 'DELETE' });
      loadTransactions();
    };
  });
  box.querySelectorAll('[data-edit-tx]').forEach((b) => {
    b.onclick = () => startTxEdit(Number(b.dataset.editTx));
  });
}

async function loadTransactions() {
  txCache = await api(`/api/transactions?month=${state.month}`);
  renderTransactions();
}

$('#tx-search').addEventListener('input', renderTransactions);
$('#tx-filter-type').addEventListener('change', renderTransactions);

function startTxEdit(id) {
  const t = txCache.find((x) => x.id === id);
  if (!t) return;
  const f = $('#form-tx');
  txEditingId = id;
  f.type.value = t.type;
  f.description.value = t.description;
  f.category.value = t.category;
  f.amount.value = (t.amount_cents / 100).toFixed(2).replace('.', ',');
  f.date.value = t.date;
  f.recurring.checked = !!t.recurring;
  $('#tx-submit').textContent = 'Salvar alterações';
  $('#tx-cancel').hidden = false;
  f.scrollIntoView({ behavior: 'smooth', block: 'center' });
  f.description.focus();
}

function endTxEdit() {
  const f = $('#form-tx');
  txEditingId = null;
  f.reset();
  f.date.value = defaultDate();
  $('#tx-submit').textContent = 'Adicionar';
  $('#tx-cancel').hidden = true;
}

$('#tx-cancel').addEventListener('click', endTxEdit);

$('#form-tx').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const cents = parseMoney(f.amount.value);
  if (!cents) { alert('Informe um valor válido, ex.: 1.250,00'); return; }
  const payload = {
    type: f.type.value,
    description: f.description.value,
    category: f.category.value || 'Outros',
    amount_cents: cents,
    date: f.date.value,
    recurring: f.recurring.checked,
  };
  if (txEditingId) {
    await api(`/api/transactions/${txEditingId}`, { method: 'PUT', body: JSON.stringify(payload) });
  } else {
    await api('/api/transactions', { method: 'POST', body: JSON.stringify(payload) });
  }
  state.month = f.date.value.slice(0, 7);
  endTxEdit();
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

/* ---------- planos: metas + orçamentos ---------- */
async function loadPlanning() {
  const [goals, budgets, proj] = await Promise.all([
    api('/api/goals'), api('/api/budgets'), api('/api/projection'),
  ]);

  // sobra média dos próximos 3 meses projetados (para estimar quando a meta chega)
  const next3 = proj.months.slice(0, 3);
  const avgLeftover = next3.length
    ? Math.max(0, Math.round(next3.reduce((s, m) => s + m.leftover, 0) / next3.length)) : 0;

  const gbox = $('#goal-list');
  if (!goals.length) {
    gbox.innerHTML = '<p class="empty">Nenhuma meta ainda. Que tal começar por uma reserva de emergência?</p>';
  } else {
    gbox.innerHTML = goals.map((g) => {
      const pct = Math.min(100, Math.round(g.saved_cents / g.target_cents * 100));
      const done = g.saved_cents >= g.target_cents;
      const missing = g.target_cents - g.saved_cents;
      let eta = '';
      if (!done && avgLeftover > 0) {
        const monthsNeeded = Math.ceil(missing / avgLeftover);
        const d = new Date(); d.setMonth(d.getMonth() + monthsNeeded);
        eta = `guardando sua sobra (~${money(avgLeftover)}/mês), você chega lá em ~${monthsNeeded} ${monthsNeeded === 1 ? 'mês' : 'meses'} (${d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })})`;
      } else if (!done) {
        eta = 'sua sobra projetada está zerada — reveja despesas para alimentar a meta';
      }
      return `<div class="goal-row">
        <div class="goal-head">
          <strong>${esc(g.name)}</strong>
          <span>${money(g.saved_cents)} <span style="color:var(--muted)">de ${money(g.target_cents)}</span></span>
        </div>
        <div class="meter"><div class="meter-fill ${done ? 'ok' : ''}" style="width:${pct}%"></div></div>
        <div class="goal-foot">
          <span>${done ? '🎉 Meta atingida!' : `${pct}% · ${eta}`}${g.target_date ? ` · prazo: ${fmtDate(g.target_date)}` : ''}</span>
          <span class="goal-actions">
            ${done ? '' : `<button class="btn small" data-goal-add="${g.id}">+ Guardar</button>`}
            ${g.saved_cents > 0 ? `<button class="btn ghost small" data-goal-sub="${g.id}" title="Corrigir valor guardado">−</button>` : ''}
            <button class="btn danger-ghost small" data-goal-del="${g.id}">Excluir</button>
          </span>
        </div>
      </div>`;
    }).join('');

    gbox.querySelectorAll('[data-goal-add]').forEach((b) => {
      b.onclick = async () => {
        const v = prompt('Quanto você guardou para esta meta? (R$)');
        if (v === null) return;
        const cents = parseMoney(v);
        if (!cents) { alert('Valor inválido.'); return; }
        await api(`/api/goals/${b.dataset.goalAdd}/add`, { method: 'POST', body: JSON.stringify({ amount_cents: cents }) });
        loadPlanning();
      };
    });
    gbox.querySelectorAll('[data-goal-sub]').forEach((b) => {
      b.onclick = async () => {
        const v = prompt('Quanto retirar do valor guardado? (R$)');
        if (v === null) return;
        const cents = parseMoney(v);
        if (!cents) { alert('Valor inválido.'); return; }
        await api(`/api/goals/${b.dataset.goalSub}/add`, { method: 'POST', body: JSON.stringify({ amount_cents: -cents }) });
        loadPlanning();
      };
    });
    gbox.querySelectorAll('[data-goal-del]').forEach((b) => {
      b.onclick = async () => {
        if (!confirm('Excluir esta meta?')) return;
        await api(`/api/goals/${b.dataset.goalDel}`, { method: 'DELETE' });
        loadPlanning();
      };
    });
  }

  const bbox = $('#budget-list');
  if (!budgets.items.length) {
    bbox.innerHTML = '<p class="empty">Nenhum limite definido. Comece pela categoria em que você mais gasta.</p>';
  } else {
    bbox.innerHTML = budgets.items.map((b) => {
      const pct = Math.round(b.spent_cents / b.limit_cents * 100);
      const level = pct > 100 ? 'over' : pct >= 75 ? 'warn' : '';
      const label = pct > 100
        ? `🚨 estourou em ${money(b.spent_cents - b.limit_cents)}`
        : pct >= 75 ? `⚠️ atenção: ${pct}% usado` : `${pct}% usado`;
      return `<div class="goal-row">
        <div class="goal-head">
          <strong>${esc(b.category)}</strong>
          <span>${money(b.spent_cents)} <span style="color:var(--muted)">de ${money(b.limit_cents)}</span></span>
        </div>
        <div class="meter"><div class="meter-fill ${level}" style="width:${Math.min(100, pct)}%"></div></div>
        <div class="goal-foot">
          <span>${label} em ${fullMonthName(budgets.month)}</span>
          <button class="btn danger-ghost small" data-budget-del="${b.id}">Remover</button>
        </div>
      </div>`;
    }).join('');
    bbox.querySelectorAll('[data-budget-del]').forEach((btn) => {
      btn.onclick = async () => {
        await api(`/api/budgets/${btn.dataset.budgetDel}`, { method: 'DELETE' });
        loadPlanning();
      };
    });
  }
}

$('#form-goal').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const cents = parseMoney(f.target.value);
  if (!cents) { alert('Informe o valor alvo, ex.: 5.000,00'); return; }
  await api('/api/goals', {
    method: 'POST',
    body: JSON.stringify({ name: f.name.value, target_cents: cents, target_date: f.target_date.value || null }),
  });
  f.reset();
  loadPlanning();
});

$('#form-budget').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const cents = parseMoney(f.limit.value);
  if (!cents) { alert('Informe o limite mensal, ex.: 300,00'); return; }
  await api('/api/budgets', {
    method: 'POST',
    body: JSON.stringify({ category: f.category.value, limit_cents: cents }),
  });
  f.reset();
  loadPlanning();
});

/* ---------- mercado ---------- */
const fmtNum = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function loadMarket() {
  const errBox = $('#market-error');
  errBox.innerHTML = '';
  let mkt;
  try {
    mkt = await api('/api/market');
  } catch (err) {
    errBox.innerHTML = '<div class="card" style="margin-bottom:16px;color:var(--bad-text)">⚠️ Não foi possível carregar as cotações agora. Verifique a internet do servidor e tente de novo.</div>';
    return;
  }
  if (!mkt.rates.length && !mkt.indicators.length) {
    errBox.innerHTML = '<div class="card" style="margin-bottom:16px;color:var(--bad-text)">⚠️ As fontes de cotação não responderam. Tente novamente em alguns minutos.</div>';
    return;
  }
  $('#market-updated').textContent = 'atualizado ' + new Date(mkt.fetched_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) + (mkt.fake ? ' (demonstração)' : '');

  const ratesBox = $('#market-rates');
  ratesBox.innerHTML = mkt.rates.map((r) => `
    <div class="card tile rate-card">
      <div class="label">${esc(r.name)} (${r.code})</div>
      <div class="value">${money(Math.round(r.bid * 100))}</div>
      <div class="rate-foot">
        <span class="delta ${r.pct_change > 0 ? 'up' : r.pct_change < 0 ? 'down' : 'flat'}">${r.pct_change > 0 ? '▲' : r.pct_change < 0 ? '▼' : '='} ${fmtNum.format(Math.abs(r.pct_change))}% hoje</span>
        <span class="spark" data-spark="${r.code}"></span>
      </div>
    </div>`).join('');
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  for (const r of mkt.rates) {
    const holder = ratesBox.querySelector(`[data-spark="${r.code}"]`);
    if (holder && r.history.length > 1) Charts.sparkline(holder, r.history, accent);
  }

  $('#market-indicators').innerHTML = mkt.indicators.map((i) => `
    <div class="card tile">
      <div class="label">${esc(i.label)}</div>
      <div class="value">${fmtNum.format(i.value)}%</div>
      <div class="hint">${i.key === 'ipca12' ? 'inflação acumulada em 12 meses' : 'ao ano'}</div>
    </div>`).join('');

  // conversor
  const sel = $('#conv-currency');
  sel.innerHTML = mkt.rates.map((r) => `<option value="${r.bid}" data-code="${r.code}">${esc(r.name)}</option>`).join('');
  const note = () => {
    const opt = sel.selectedOptions[0];
    $('#conv-note').textContent = `1 ${opt.dataset.code} = ${money(Math.round(Number(sel.value) * 100))}`;
  };
  const toBrl = () => {
    const v = parseMoney($('#conv-foreign').value);
    $('#conv-brl').value = v ? fmtNum.format((v / 100) * Number(sel.value)) : '';
  };
  const toForeign = () => {
    const v = parseMoney($('#conv-brl').value);
    $('#conv-foreign').value = v ? fmtNum.format((v / 100) / Number(sel.value)) : '';
  };
  $('#conv-foreign').oninput = toBrl;
  $('#conv-brl').oninput = toForeign;
  sel.onchange = () => { note(); toBrl(); };
  note();

  // simulador: pré-preenche com a sobra projetada e o CDI
  const cdi = mkt.indicators.find((i) => i.key === 'cdi');
  if (cdi && !$('#sim-rate').value) $('#sim-rate').value = fmtNum.format(cdi.value);
  if (!$('#sim-monthly').value) {
    try {
      const proj = await api('/api/projection');
      const leftover = proj.months[0]?.leftover ?? 0;
      if (leftover > 0) $('#sim-monthly').value = fmtNum.format(leftover / 100);
    } catch { /* opcional */ }
  }
  runSimulator();
}

function runSimulator() {
  const monthly = parseMoney($('#sim-monthly').value);
  const rate = Number(String($('#sim-rate').value).replace(',', '.'));
  const years = Number($('#sim-years').value);
  const out = $('#sim-result');
  if (!monthly || !Number.isFinite(rate) || rate <= 0) { out.innerHTML = ''; return; }
  const i = Math.pow(1 + rate / 100, 1 / 12) - 1;
  const n = years * 12;
  const fv = Math.round(monthly * ((Math.pow(1 + i, n) - 1) / i));
  const invested = monthly * n;
  out.innerHTML = `
    <div class="sim-box">
      <div class="sim-total">${money(fv)}</div>
      <div class="sim-detail">investindo ${money(monthly)}/mês por ${years} ano(s) a ${fmtNum.format(rate)}% a.a.<br>
      Você aporta <strong>${money(invested)}</strong> e os juros somam <strong class="amount-pos">${money(fv - invested)}</strong>.</div>
    </div>`;
}
['sim-monthly', 'sim-rate', 'sim-years'].forEach((id) => {
  document.getElementById(id).addEventListener('input', runSimulator);
});

/* ---------- backup / restauração ---------- */
$('#btn-restore').addEventListener('click', () => $('#restore-file').click());
$('#restore-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (!confirm('Restaurar substitui TODOS os seus dados atuais pelos do arquivo. Continuar?')) return;
  try {
    const text = await file.text();
    await api('/api/restore', { method: 'POST', body: text });
    alert('Backup restaurado com sucesso! ✔');
    refresh();
  } catch (err) {
    alert('Não foi possível restaurar: ' + err.message);
  }
});

/* ---------- tema claro/escuro/automático ---------- */
const THEMES = ['auto', 'light', 'dark'];
const THEME_LABEL = { auto: 'Tema: auto', light: 'Tema: claro', dark: 'Tema: escuro' };

function applyTheme(theme) {
  if (theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  document.querySelectorAll('.js-theme-label').forEach((el) => { el.textContent = THEME_LABEL[theme]; });
}

let currentTheme = localStorage.getItem('theme') || 'auto';
applyTheme(currentTheme);
document.querySelectorAll('.js-theme').forEach((b) => {
  b.addEventListener('click', () => {
    currentTheme = THEMES[(THEMES.indexOf(currentTheme) + 1) % THEMES.length];
    localStorage.setItem('theme', currentTheme);
    applyTheme(currentTheme);
    refresh(); // re-renderiza os gráficos com as cores do novo tema
  });
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
  if (view === 'planning') loadPlanning().catch(showError);
  if (view === 'market') loadMarket().catch(showError);
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
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

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
