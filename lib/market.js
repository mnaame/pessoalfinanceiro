'use strict';
// Cotações e indicadores com cache em memória (10 min) para respeitar as APIs
// públicas. Fontes: AwesomeAPI (câmbio/cripto) e Banco Central do Brasil (SGS).

const TTL_MS = 10 * 60 * 1000;
let cache = { data: null, ts: 0 };

const PAIRS = [
  { code: 'USD', pair: 'USD-BRL', name: 'Dólar americano', symbol: 'US$' },
  { code: 'EUR', pair: 'EUR-BRL', name: 'Euro', symbol: '€' },
  { code: 'BTC', pair: 'BTC-BRL', name: 'Bitcoin', symbol: '₿' },
];

// Séries do SGS/Bacen: 432 = meta Selic (% a.a.), 4389 = CDI anualizado (% a.a.),
// 13522 = IPCA acumulado em 12 meses (%).
const SGS = [
  { key: 'selic', serie: 432, label: 'Selic (meta)' },
  { key: 'cdi', serie: 4389, label: 'CDI' },
  { key: 'ipca12', serie: 13522, label: 'IPCA 12 meses' },
];

async function fetchJson(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(8000),
    headers: { 'User-Agent': 'meu-financeiro/1.0' },
  });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

async function fetchRates() {
  const codes = PAIRS.map((p) => p.pair).join(',');
  const last = await fetchJson(`https://economia.awesomeapi.com.br/json/last/${codes}`);
  const rates = [];
  for (const p of PAIRS) {
    const row = last[p.pair.replace('-', '')];
    if (!row) continue;
    let history = [];
    try {
      const daily = await fetchJson(`https://economia.awesomeapi.com.br/json/daily/${p.pair}/30`);
      history = daily.map((d) => Number(d.bid)).filter(Number.isFinite).reverse();
    } catch { /* sparkline é opcional */ }
    rates.push({
      code: p.code,
      name: p.name,
      symbol: p.symbol,
      bid: Number(row.bid),
      pct_change: Number(row.pctChange),
      history,
    });
  }
  return rates;
}

async function fetchIndicators() {
  const out = [];
  const results = await Promise.allSettled(SGS.map((s) =>
    fetchJson(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${s.serie}/dados/ultimos/1?formato=json`)));
  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && Array.isArray(r.value) && r.value.length) {
      out.push({ key: SGS[i].key, label: SGS[i].label, value: Number(String(r.value[0].valor).replace(',', '.')) });
    }
  });
  return out;
}

// Amostra estática para desenvolver sem internet: MARKET_FAKE=1 node server.js
function fakeData() {
  const wave = (base, amp) => Array.from({ length: 30 }, (_, i) => base + Math.sin(i / 4) * amp + i * amp * 0.02);
  return {
    rates: [
      { code: 'USD', name: 'Dólar americano', symbol: 'US$', bid: 5.43, pct_change: -0.32, history: wave(5.4, 0.06) },
      { code: 'EUR', name: 'Euro', symbol: '€', bid: 6.38, pct_change: 0.18, history: wave(6.3, 0.07) },
      { code: 'BTC', name: 'Bitcoin', symbol: '₿', bid: 612345.0, pct_change: 2.41, history: wave(600000, 12000) },
    ],
    indicators: [
      { key: 'selic', label: 'Selic (meta)', value: 15.0 },
      { key: 'cdi', label: 'CDI', value: 14.9 },
      { key: 'ipca12', label: 'IPCA 12 meses', value: 5.3 },
    ],
    fetched_at: new Date().toISOString(),
    fake: true,
  };
}

async function getMarket() {
  if (process.env.MARKET_FAKE === '1') return fakeData();
  const now = Date.now();
  if (cache.data && now - cache.ts < TTL_MS) return cache.data;

  const [rates, indicators] = await Promise.all([
    fetchRates().catch(() => []),
    fetchIndicators().catch(() => []),
  ]);
  const data = { rates, indicators, fetched_at: new Date().toISOString() };
  if (rates.length || indicators.length) cache = { data, ts: now }; // não guarda falha total
  return data;
}

module.exports = { getMarket };
