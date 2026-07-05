/* Gráficos em SVG puro — sem bibliotecas externas. */
'use strict';

const Charts = (() => {
  const NS = 'http://www.w3.org/2000/svg';

  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  function el(tag, attrs = {}, parent = null) {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (parent) parent.appendChild(node);
    return node;
  }

  const fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const fmtCompact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
  const money = (cents) => fmtBRL.format(cents / 100);
  const moneyShort = (cents) => 'R$ ' + fmtCompact.format(cents / 100);

  function monthLabel(ym) {
    const [y, m] = ym.split('-');
    const names = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    return `${names[Number(m) - 1]}/${y.slice(2)}`;
  }

  function niceTicks(min, max, count = 4) {
    if (min === max) { max = min + 1; }
    const span = max - min;
    const step = Math.pow(10, Math.floor(Math.log10(span / count)));
    const err = span / count / step;
    const mult = err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1;
    const s = step * mult;
    // os ticks precisam COBRIR o domínio: do piso abaixo do mínimo até o teto acima do máximo
    const ticks = [];
    for (let v = Math.floor(min / s) * s; ; v += s) {
      ticks.push(v);
      if (v >= max - 1e-9) break;
      if (ticks.length > 50) break;
    }
    return ticks;
  }

  function setupBox(container) {
    container.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'chart-box';
    container.appendChild(box);
    const tip = document.createElement('div');
    tip.className = 'viz-tooltip';
    box.appendChild(tip);
    return { box, tip };
  }

  function showTip(tip, box, x, y, html) {
    tip.innerHTML = html;
    const rect = box.getBoundingClientRect();
    tip.style.left = Math.min(Math.max(x, 70), rect.width - 70) + 'px';
    tip.style.top = y + 'px';
    tip.classList.add('show');
  }
  const hideTip = (tip) => tip.classList.remove('show');

  // Coluna com topo arredondado (4px) e base reta, crescendo da linha de base.
  function roundedColumn(g, x, yTop, w, h, fill) {
    if (h <= 0) return null;
    const r = Math.min(4, w / 2, h);
    const d = `M ${x} ${yTop + h} L ${x} ${yTop + r} Q ${x} ${yTop} ${x + r} ${yTop}` +
      ` L ${x + w - r} ${yTop} Q ${x + w} ${yTop} ${x + w} ${yTop + r} L ${x + w} ${yTop + h} Z`;
    return el('path', { d, fill }, g);
  }

  function frame(svg, layout, ticks, yScale, formatTick) {
    const { left, right, top, bottom, W, H } = layout;
    for (const t of ticks) {
      const y = yScale(t);
      el('line', { x1: left, x2: W - right, y1: y, y2: y, stroke: css('--grid'), 'stroke-width': 1 }, svg);
      const txt = el('text', { x: left - 8, y: y + 4, 'text-anchor': 'end', 'font-size': 11, fill: css('--muted') }, svg);
      txt.textContent = formatTick(t);
    }
    // linha de base no zero (ou no menor tick)
    const zeroY = yScale(Math.max(0, ticks[0]));
    el('line', { x1: left, x2: W - right, y1: zeroY, y2: zeroY, stroke: css('--baseline'), 'stroke-width': 1 }, svg);
  }

  function legend(container, items) {
    const box = document.createElement('div');
    box.className = 'legend';
    for (const it of items) {
      const key = document.createElement('span');
      key.className = 'key';
      key.innerHTML = `<span class="swatch" style="background:${it.color}"></span>${it.name}`;
      box.appendChild(key);
    }
    container.appendChild(box);
  }

  /* === 1. Colunas agrupadas: receitas × despesas por mês === */
  function groupedColumns(container, rows, series) {
    const { box, tip } = setupBox(container);
    const W = 620, H = 240;
    const layout = { left: 68, right: 8, top: 12, bottom: 28, W, H };
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img' });
    box.appendChild(svg);

    const maxVal = Math.max(1, ...rows.flatMap((r) => series.map((s) => r[s.field])));
    const ticks = niceTicks(0, maxVal);
    const yMax = ticks[ticks.length - 1];
    const plotH = H - layout.top - layout.bottom;
    const yScale = (v) => layout.top + plotH * (1 - v / yMax);

    frame(svg, layout, ticks, yScale, moneyShort);

    const plotW = W - layout.left - layout.right;
    const band = plotW / rows.length;
    const barW = Math.min(24, (band - 16) / series.length - 2);
    const g = el('g', {}, svg);

    rows.forEach((row, i) => {
      const cx = layout.left + band * i + band / 2;
      const groupW = series.length * barW + (series.length - 1) * 2; // 2px de respiro entre barras
      series.forEach((s, j) => {
        const v = row[s.field];
        const x = cx - groupW / 2 + j * (barW + 2);
        const yTop = yScale(v);
        roundedColumn(g, x, yTop, barW, yScale(0) - yTop, s.color);
      });
      const lbl = el('text', { x: cx, y: H - 8, 'text-anchor': 'middle', 'font-size': 11, fill: css('--muted') }, svg);
      lbl.textContent = monthLabel(row.month);

      // alvo de interação da coluna inteira (maior que a marca)
      const hit = el('rect', { x: layout.left + band * i, y: layout.top, width: band, height: plotH, fill: 'transparent' }, svg);
      hit.addEventListener('mousemove', (e) => {
        const r = box.getBoundingClientRect();
        showTip(tip, box, e.clientX - r.left, e.clientY - r.top,
          `<strong>${monthLabel(row.month)}</strong><br>` +
          series.map((s) => `${s.name}: ${money(row[s.field])}`).join('<br>'));
      });
      hit.addEventListener('mouseleave', () => hideTip(tip));
    });

    legend(container, series);
  }

  /* === 2. Barras horizontais: despesas por categoria (uma série — sem legenda) === */
  function categoryBars(container, items) {
    const { box, tip } = setupBox(container);
    if (!items.length) {
      box.innerHTML = '<p class="empty">Sem despesas neste mês.</p>';
      return;
    }
    const rowH = 34;
    const W = 620, H = items.length * rowH + 8;
    const left = 8, labelW = 130, right = 90;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img' });
    box.appendChild(svg);

    const maxVal = Math.max(...items.map((i) => i.total));
    const plotW = W - left - labelW - right;

    items.forEach((item, i) => {
      const y = i * rowH + 6;
      const w = Math.max(2, (item.total / maxVal) * plotW);
      const lbl = el('text', { x: left + labelW - 10, y: y + 15, 'text-anchor': 'end', 'font-size': 12.5, fill: css('--ink-2') }, svg);
      lbl.textContent = item.category.length > 16 ? item.category.slice(0, 15) + '…' : item.category;

      // barra: ponta arredondada 4px, base reta
      const r = Math.min(4, w / 2);
      const x0 = left + labelW;
      const d = `M ${x0} ${y} L ${x0 + w - r} ${y} Q ${x0 + w} ${y} ${x0 + w} ${y + r}` +
        ` L ${x0 + w} ${y + 22 - r} Q ${x0 + w} ${y + 22} ${x0 + w - r} ${y + 22} L ${x0} ${y + 22} Z`;
      const bar = el('path', { d, fill: css('--accent') }, svg);

      // valor na ponta da barra (rótulo direto)
      const val = el('text', { x: x0 + w + 8, y: y + 15, 'font-size': 12, fill: css('--ink'), 'font-weight': 600 }, svg);
      val.textContent = moneyShort(item.total);

      bar.addEventListener('mousemove', (e) => {
        const rect = box.getBoundingClientRect();
        showTip(tip, box, e.clientX - rect.left, e.clientY - rect.top,
          `<strong>${item.category}</strong><br>${money(item.total)}`);
      });
      bar.addEventListener('mouseleave', () => hideTip(tip));
    });
  }

  /* === 3. Projeção: colunas (carga de parcelas) + linha (sobra mensal) === */
  function projectionChart(container, months) {
    const { box, tip } = setupBox(container);
    const shown = months.slice(0, 24);
    const W = 720, H = 260;
    const layout = { left: 72, right: 14, top: 14, bottom: 30, W, H };
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img' });
    box.appendChild(svg);

    const values = shown.flatMap((m) => [m.load, m.leftover]);
    const minV = Math.min(0, ...values);
    const maxV = Math.max(1, ...values);
    const ticks = niceTicks(minV, maxV);
    const lo = ticks[0], hi = ticks[ticks.length - 1];
    const plotH = H - layout.top - layout.bottom;
    const yScale = (v) => layout.top + plotH * (1 - (v - lo) / (hi - lo));

    frame(svg, layout, ticks, yScale, moneyShort);
    const zeroY = yScale(0);
    el('line', { x1: layout.left, x2: W - layout.right, y1: zeroY, y2: zeroY, stroke: css('--baseline'), 'stroke-width': 1 }, svg);

    const plotW = W - layout.left - layout.right;
    const band = plotW / shown.length;
    const barW = Math.min(14, band - 4);
    const gBars = el('g', {}, svg);

    const colorBar = css('--aqua');
    const colorLine = css('--accent');

    shown.forEach((m, i) => {
      const x = layout.left + band * i + (band - barW) / 2;
      const yTop = yScale(m.load);
      roundedColumn(gBars, x, yTop, barW, zeroY - yTop, colorBar);
      if (i % Math.ceil(shown.length / 8) === 0) {
        const lbl = el('text', { x: layout.left + band * i + band / 2, y: H - 8, 'text-anchor': 'middle', 'font-size': 10.5, fill: css('--muted') }, svg);
        lbl.textContent = monthLabel(m.month);
      }
    });

    // linha da sobra mensal — 2px, junções arredondadas
    const pts = shown.map((m, i) => [layout.left + band * i + band / 2, yScale(m.leftover)]);
    el('path', {
      d: pts.map((p, i) => `${i ? 'L' : 'M'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' '),
      fill: 'none', stroke: colorLine, 'stroke-width': 2,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round',
    }, svg);
    // marcador no fim da linha com anel na cor da superfície
    const last = pts[pts.length - 1];
    el('circle', { cx: last[0], cy: last[1], r: 6, fill: css('--surface') }, svg);
    el('circle', { cx: last[0], cy: last[1], r: 4, fill: colorLine }, svg);

    // rótulo direto no fim da linha
    const endLbl = el('text', {
      x: Math.min(last[0] + 8, W - 4), y: last[1] - 8,
      'font-size': 11.5, 'font-weight': 600, fill: css('--ink'), 'text-anchor': 'end',
    }, svg);
    endLbl.setAttribute('x', last[0]);
    endLbl.textContent = moneyShort(shown[shown.length - 1].leftover);

    // crosshair + tooltip
    const cross = el('line', { y1: layout.top, y2: H - layout.bottom, stroke: css('--baseline'), 'stroke-width': 1, opacity: 0 }, svg);
    const hover = el('rect', { x: layout.left, y: layout.top, width: plotW, height: plotH, fill: 'transparent' }, svg);
    hover.addEventListener('mousemove', (e) => {
      const rect = box.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width * W;
      const i = Math.min(shown.length - 1, Math.max(0, Math.floor((px - layout.left) / band)));
      const m = shown[i];
      const cx = layout.left + band * i + band / 2;
      cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('opacity', 1);
      showTip(tip, box, cx / W * rect.width, e.clientY - rect.top,
        `<strong>${monthLabel(m.month)}</strong><br>` +
        `Parcelas: ${money(m.load)}<br>Sobra do mês: ${money(m.leftover)}<br>Acumulado: ${money(m.cumulative)}`);
    });
    hover.addEventListener('mouseleave', () => { cross.setAttribute('opacity', 0); hideTip(tip); });

    legend(container, [
      { name: 'Sobra mensal projetada', color: colorLine },
      { name: 'Parcelas a pagar no mês', color: colorBar },
    ]);
  }

  /* === 4. Linha única: evolução do saldo acumulado (com área) === */
  function wealthChart(container, months) {
    const { box, tip } = setupBox(container);
    if (months.length < 2) {
      box.innerHTML = '<p class="empty">Registre pelo menos dois meses de lançamentos para ver sua evolução.</p>';
      return;
    }
    const W = 720, H = 240;
    const layout = { left: 72, right: 14, top: 14, bottom: 30, W, H };
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img' });
    box.appendChild(svg);

    const values = months.map((m) => m.cumulative);
    const ticks = niceTicks(Math.min(0, ...values), Math.max(1, ...values));
    const lo = ticks[0], hi = ticks[ticks.length - 1];
    const plotH = H - layout.top - layout.bottom;
    const yScale = (v) => layout.top + plotH * (1 - (v - lo) / (hi - lo));

    frame(svg, layout, ticks, yScale, moneyShort);
    const zeroY = yScale(0);
    el('line', { x1: layout.left, x2: W - layout.right, y1: zeroY, y2: zeroY, stroke: css('--baseline'), 'stroke-width': 1 }, svg);

    const plotW = W - layout.left - layout.right;
    const band = plotW / months.length;
    const color = css('--accent');
    const pts = months.map((m, i) => [layout.left + band * i + band / 2, yScale(m.cumulative)]);
    const lineD = pts.map((p, i) => `${i ? 'L' : 'M'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');

    // área: lavagem de 10% da cor da série até a linha do zero
    el('path', {
      d: `${lineD} L ${pts[pts.length - 1][0].toFixed(1)} ${zeroY} L ${pts[0][0].toFixed(1)} ${zeroY} Z`,
      fill: color, opacity: 0.1,
    }, svg);
    el('path', { d: lineD, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);

    const last = pts[pts.length - 1];
    el('circle', { cx: last[0], cy: last[1], r: 6, fill: css('--surface') }, svg);
    el('circle', { cx: last[0], cy: last[1], r: 4, fill: color }, svg);
    const endLbl = el('text', {
      x: last[0], y: last[1] - 10, 'text-anchor': 'end',
      'font-size': 11.5, 'font-weight': 600, fill: css('--ink'),
    }, svg);
    endLbl.textContent = moneyShort(months[months.length - 1].cumulative);

    // rótulos de mês (no máximo 8)
    months.forEach((m, i) => {
      if (i % Math.ceil(months.length / 8) === 0) {
        const lbl = el('text', { x: layout.left + band * i + band / 2, y: H - 8, 'text-anchor': 'middle', 'font-size': 10.5, fill: css('--muted') }, svg);
        lbl.textContent = monthLabel(m.month);
      }
    });

    // crosshair + tooltip
    const cross = el('line', { y1: layout.top, y2: H - layout.bottom, stroke: css('--baseline'), 'stroke-width': 1, opacity: 0 }, svg);
    const hover = el('rect', { x: layout.left, y: layout.top, width: plotW, height: plotH, fill: 'transparent' }, svg);
    hover.addEventListener('mousemove', (e) => {
      const rect = box.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width * W;
      const i = Math.min(months.length - 1, Math.max(0, Math.floor((px - layout.left) / band)));
      const m = months[i];
      const cx = layout.left + band * i + band / 2;
      cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('opacity', 1);
      showTip(tip, box, cx / W * rect.width, e.clientY - rect.top,
        `<strong>${monthLabel(m.month)}</strong><br>` +
        `Resultado do mês: ${money(m.net)}<br>Saldo acumulado: ${money(m.cumulative)}`);
    });
    hover.addEventListener('mouseleave', () => { cross.setAttribute('opacity', 0); hideTip(tip); });
  }

  /* === 5. Sparkline: mini-linha de tendência (sem eixos) === */
  function sparkline(container, values, color) {
    container.innerHTML = '';
    if (!values || values.length < 2) return;
    const W = 120, H = 32, pad = 3;
    const min = Math.min(...values), max = Math.max(...values);
    const span = max - min || 1;
    const x = (i) => pad + (i / (values.length - 1)) * (W - pad * 2);
    const y = (v) => pad + (1 - (v - min) / span) * (H - pad * 2);
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, 'aria-hidden': 'true' });
    el('path', {
      d: values.map((v, i) => `${i ? 'L' : 'M'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' '),
      fill: 'none', stroke: color, 'stroke-width': 1.5,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round',
    }, svg);
    const lx = x(values.length - 1), ly = y(values[values.length - 1]);
    el('circle', { cx: lx, cy: ly, r: 3.5, fill: css('--surface') }, svg);
    el('circle', { cx: lx, cy: ly, r: 2.2, fill: color }, svg);
    container.appendChild(svg);
  }

  return { groupedColumns, categoryBars, projectionChart, wealthChart, sparkline, money, moneyShort, monthLabel };
})();
