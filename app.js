'use strict';

/* ------------------------------------------------------------------ *
 * Estado e persistência
 * ------------------------------------------------------------------ */

const STORAGE_KEY = 'financas-v1';
// Cores fixas por ordem de cadastro (validadas para daltonismo).
const PERSON_COLORS = ['#2a78d6', '#e87ba4', '#eda100', '#6250d6', '#e34948', '#008300'];

const DEFAULT_STATE = () => ({
  people: [
    { id: 'p1', name: 'Julia', color: PERSON_COLORS[0] },
    { id: 'p2', name: 'Pai', color: PERSON_COLORS[1] },
    { id: 'p3', name: 'Davis', color: PERSON_COLORS[2] },
  ],
  cards: [
    { id: 'c1', name: 'Cartão principal', closingDay: 3, dueDay: 10, limit: 8000 },
  ],
  categories: {
    saida: ['Mercado', 'Casa', 'Contas (luz, água, internet)', 'Alimentação fora', 'Transporte', 'Saúde',
      'Compras', 'Lazer', 'Assinaturas', 'Educação', 'Outros'],
    entrada: ['Salário', 'Pix recebido', 'Freelance', 'Reembolso', 'Outros'],
  },
  tx: [],
});

let state = load();
const ui = {
  month: monthOf(todayISO()),
  person: 'all',
  type: 'all',
  search: '',
};

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return Object.assign(DEFAULT_STATE(), JSON.parse(raw));
  } catch (e) { /* armazenamento indisponível */ }
  return DEFAULT_STATE();
}

// Com a nuvem ativa, o navegador não guarda cópia própria (o Supabase é a fonte).
function save() {
  if (typeof cloud !== 'undefined' && cloud.active) return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignora */ }
}

/* ------------------------------------------------------------------ *
 * Datas, meses e dinheiro
 * ------------------------------------------------------------------ */

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function pad(n) { return String(n).padStart(2, '0'); }
function monthOf(iso) { return iso.slice(0, 7); }
function dayOf(iso) { return Number(iso.slice(8, 10)); }
function addMonths(key, n) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
function monthDiff(a, b) { // b - a, em meses
  const [ya, ma] = a.split('-').map(Number);
  const [yb, mb] = b.split('-').map(Number);
  return (yb - ya) * 12 + (mb - ma);
}
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto',
  'setembro', 'outubro', 'novembro', 'dezembro'];
function monthName(key, short = false) {
  const [y, m] = key.split('-').map(Number);
  const name = MONTHS[m - 1];
  return short ? `${name.slice(0, 3)}/${String(y).slice(2)}` : `${name} ${y}`;
}

const fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
function money(v) { return fmtBRL.format(v || 0); }
function moneyShort(v) {
  const a = Math.abs(v);
  if (a >= 1e6) return `R$ ${(v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (a >= 1e3) return `R$ ${(v / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  return `R$ ${Math.round(v).toLocaleString('pt-BR')}`;
}
function parseMoney(s) {
  s = String(s).replace(/[R$\s]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}
function round2(n) { return Math.round(n * 100) / 100; }
function uid() { return Math.random().toString(36).slice(2, 10); }
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ------------------------------------------------------------------ *
 * Regras do cartão e ocorrências por mês
 * ------------------------------------------------------------------ */

function cardById(id) { return state.cards.find(c => c.id === id) || state.cards[0]; }
function personById(id) {
  return state.people.find(p => p.id === id) || { id, name: '—', color: '#c3c2b7' };
}

// Mês em que vence a fatura onde a compra entra.
function billMonth(dateISO, card) {
  if (!card) return monthOf(dateISO);
  let closing = monthOf(dateISO);
  if (dayOf(dateISO) > card.closingDay) closing = addMonths(closing, 1);
  return card.dueDay > card.closingDay ? closing : addMonths(closing, 1);
}

function isCredit(t) { return t.type === 'saida' && t.method === 'credito'; }

// Valor de cada parcela (a última absorve o arredondamento).
function installmentValue(t, i) {
  const n = t.installments || 1;
  const base = round2(t.amount / n);
  return i === n - 1 ? round2(t.amount - base * (n - 1)) : base;
}

// Todas as ocorrências (lançamento, parcela ou repetição) de um mês.
function occurrences(key, personFilter = ui.person) {
  const out = [];
  for (const t of state.tx) {
    if (personFilter !== 'all' && t.person !== personFilter) continue;
    const credit = isCredit(t);
    const start = credit ? billMonth(t.date, cardById(t.cardId)) : monthOf(t.date);

    if (t.recurring) {
      if (key >= start && (!t.endMonth || key <= t.endMonth)) {
        out.push({ t, amount: t.amount, day: dayOf(t.date), part: null });
      }
      continue;
    }
    if (credit) {
      const n = t.installments || 1;
      const i = monthDiff(start, key);
      if (i >= 0 && i < n) {
        out.push({ t, amount: installmentValue(t, i), day: dayOf(t.date), part: n > 1 ? [i + 1, n] : null });
      }
      continue;
    }
    if (monthOf(t.date) === key) out.push({ t, amount: t.amount, day: dayOf(t.date), part: null });
  }
  return out;
}

function totals(occ) {
  let entrada = 0, saida = 0, credito = 0;
  for (const o of occ) {
    if (o.t.type === 'entrada') entrada += o.amount;
    else {
      saida += o.amount;
      if (isCredit(o.t)) credito += o.amount;
    }
  }
  return { entrada: round2(entrada), saida: round2(saida), credito: round2(credito), saldo: round2(entrada - saida) };
}

/* ------------------------------------------------------------------ *
 * Renderização
 * ------------------------------------------------------------------ */

const $ = sel => document.querySelector(sel);

function render() {
  $('#monthLabel').textContent = monthName(ui.month);
  $('#emptyState').hidden = state.tx.length > 0;
  renderPersonFilter();
  const occ = occurrences(ui.month);
  renderKpis(occ);
  renderCategories(occ);
  renderPeople();
  renderTrend();
  renderCards();
  renderTxList(occ);
}

function renderPersonFilter() {
  const el = $('#personFilter');
  const chips = [{ id: 'all', name: 'Todos' }, ...state.people];
  el.innerHTML = chips.map(p => `
    <button class="chip ${ui.person === p.id ? 'on' : ''}" data-id="${p.id}" role="tab">
      ${p.color ? `<i class="swatch" style="background:${p.color}"></i>` : ''}${esc(p.name)}
    </button>`).join('');
  el.querySelectorAll('button').forEach(b => b.onclick = () => { ui.person = b.dataset.id; render(); });
}

function renderKpis(occ) {
  const now = totals(occ);
  const prev = totals(occurrences(addMonths(ui.month, -1)));
  $('#kpiIn').textContent = money(now.entrada);
  $('#kpiOut').textContent = money(now.saida);
  const bal = $('#kpiBal');
  bal.textContent = money(now.saldo);
  bal.className = 'kpi-value ' + (now.saldo < 0 ? 'neg' : now.saldo > 0 ? 'pos' : '');
  $('#kpiCard').textContent = money(now.credito);

  $('#kpiInSub').innerHTML = delta(now.entrada, prev.entrada, true);
  $('#kpiOutSub').innerHTML = delta(now.saida, prev.saida, false);
  $('#kpiBalSub').textContent = now.entrada > 0
    ? `${Math.round((now.saldo / now.entrada) * 100)}% do que entrou`
    : '';
  const share = now.saida > 0 ? Math.round((now.credito / now.saida) * 100) : 0;
  $('#kpiCardSub').textContent = now.credito > 0 ? `${share}% das saídas do mês` : 'nada no cartão este mês';
}

function delta(cur, prev, upIsGood) {
  if (!prev) return '';
  const d = cur - prev;
  if (Math.abs(d) < 0.005) return 'igual ao mês passado';
  const good = (d > 0) === upIsGood;
  const arrow = d > 0 ? '▲' : '▼';
  return `<span class="${good ? 'pos' : 'neg'}">${arrow} ${money(Math.abs(d))}</span> vs. mês passado`;
}

function renderCategories(occ) {
  const map = new Map();
  let total = 0;
  for (const o of occ) {
    if (o.t.type !== 'saida') continue;
    map.set(o.t.category, (map.get(o.t.category) || 0) + o.amount);
    total += o.amount;
  }
  const rows = [...map.entries()].sort((a, b) => b[1] - a[1]);
  const el = $('#catChart');
  if (!rows.length) { el.innerHTML = '<div class="none">Nenhuma saída neste mês.</div>'; return; }
  const max = rows[0][1];
  el.innerHTML = rows.map(([cat, v]) => `
    <div class="hbar" data-cat="${esc(cat)}" data-v="${v}">
      <span class="hbar-name" title="${esc(cat)}">${esc(cat)}</span>
      <div class="hbar-track"><div class="hbar-fill" style="width:${(v / max) * 100}%"></div></div>
      <span class="hbar-val">${money(v)}<small>${Math.round((v / total) * 100)}%</small></span>
    </div>`).join('');
  el.querySelectorAll('.hbar').forEach(row => {
    const cat = row.dataset.cat;
    const items = occ.filter(o => o.t.type === 'saida' && o.t.category === cat)
      .sort((a, b) => b.amount - a.amount).slice(0, 4);
    bindTip(row, () => `<div class="tt-title">${esc(cat)}</div>` +
      items.map(o => `<div class="tt-row"><span>${esc(o.t.desc)}</span><b>${money(o.amount)}</b></div>`).join(''));
  });
}

function renderPeople() {
  // Sempre mostra todo mundo, mesmo com filtro, para comparar.
  const occ = occurrences(ui.month, 'all');
  const rows = state.people.map(p => {
    const t = totals(occ.filter(o => o.t.person === p.id));
    return { p, ...t };
  });
  const sum = totals(occ);
  $('#peopleTable').innerHTML = `
    <table class="ptable">
      <thead><tr><th>Pessoa</th><th>Entrou</th><th>Saiu</th><th>Saldo</th></tr></thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td><span class="pname"><i style="background:${r.p.color}"></i>${esc(r.p.name)}</span></td>
            <td>${money(r.entrada)}</td>
            <td>${money(r.saida)}</td>
            <td class="${r.saldo < 0 ? 'neg' : r.saldo > 0 ? 'pos' : ''}">${money(r.saldo)}</td>
          </tr>`).join('')}
        <tr class="total"><td>Total</td><td>${money(sum.entrada)}</td><td>${money(sum.saida)}</td>
          <td class="${sum.saldo < 0 ? 'neg' : sum.saldo > 0 ? 'pos' : ''}">${money(sum.saldo)}</td></tr>
      </tbody>
    </table>`;

  const bar = $('#peopleBar');
  const spenders = rows.filter(r => r.saida > 0);
  bar.innerHTML = spenders.map(r =>
    `<div style="flex:${r.saida};background:${r.p.color}" data-name="${esc(r.p.name)}" data-v="${r.saida}"></div>`).join('');
  bar.querySelectorAll('div').forEach(seg => bindTip(seg, () =>
    `<div class="tt-title">${esc(seg.dataset.name)}</div><div class="tt-row"><span>Saídas</span><b>${money(+seg.dataset.v)}</b></div>` +
    `<div class="tt-row"><span>Parte do total</span><b>${Math.round((+seg.dataset.v / sum.saida) * 100)}%</b></div>`));
  $('#peopleLegend').innerHTML = spenders.length
    ? '<span class="muted">Quem gastou:</span>' + spenders.map(r =>
      `<span><i style="background:${r.p.color}"></i>${esc(r.p.name)} ${Math.round((r.saida / sum.saida) * 100)}%</span>`).join('')
    : '';
}

function renderTrend() {
  const months = [];
  for (let i = -5; i <= 0; i++) months.push(addMonths(ui.month, i));
  const data = months.map(m => { const t = totals(occurrences(m)); return [t.entrada, t.saida]; });
  barChart($('#trendChart'), months, [
    { label: 'Entradas', color: 'var(--in)' },
    { label: 'Saídas', color: 'var(--out)' },
  ], data, { current: ui.month, extra: (m, i) => {
    const s = round2(data[i][0] - data[i][1]);
    return `<div class="tt-row"><span>Sobrou</span><b class="${s < 0 ? 'neg' : 'pos'}">${money(s)}</b></div>`;
  } });
}

function renderCards() {
  const occ = occurrences(ui.month);
  const el = $('#cardsSummary');
  if (!state.cards.length) {
    el.innerHTML = '<div class="none">Nenhum cartão cadastrado. Adicione em Configurações.</div>';
  } else {
    el.innerHTML = state.cards.map(c => {
      const bill = round2(occ.filter(o => isCredit(o.t) && o.t.cardId === c.id).reduce((s, o) => s + o.amount, 0));
      const committed = committedOn(c.id);
      const pct = c.limit ? Math.min(100, (committed / c.limit) * 100) : 0;
      return `
        <div class="ccard">
          <div class="ccard-top">
            <span class="ccard-name">${esc(c.name)}</span>
            <span class="ccard-days">fecha dia ${c.closingDay} · vence dia ${c.dueDay}</span>
          </div>
          <div class="ccard-bill">${money(bill)}</div>
          <div class="muted small">fatura que vence em ${monthName(ui.month)}</div>
          ${c.limit ? `
            <div class="meter ${pct > 80 ? 'warn' : ''}"><div style="width:${pct}%"></div></div>
            <div class="muted small">${money(committed)} do limite de ${money(c.limit)} comprometido
              · livre ${money(Math.max(0, c.limit - committed))}</div>` : ''}
        </div>`;
    }).join('');
  }

  // Próximas faturas (6 meses a partir do mês aberto)
  const months = [];
  for (let i = 0; i < 6; i++) months.push(addMonths(ui.month, i));
  const bills = months.map(m => [totals(occurrences(m)).credito]);
  barChart($('#nextBills'), months, [{ label: 'Fatura', color: 'var(--accent)' }], bills,
    { current: ui.month, labels: true });

  // Parcelamentos que ainda não terminaram
  const list = state.tx.filter(t => isCredit(t) && !t.recurring && (t.installments || 1) > 1 &&
    (ui.person === 'all' || t.person === ui.person))
    .map(t => {
      const first = billMonth(t.date, cardById(t.cardId));
      const n = t.installments;
      const i = monthDiff(first, ui.month); // índice da parcela no mês aberto
      let remaining = 0;
      for (let k = Math.max(0, i); k < n; k++) remaining += installmentValue(t, k);
      return { t, n, i, first, remaining: round2(remaining) };
    })
    .filter(x => x.i < x.n)
    .sort((a, b) => (b.i >= 0) - (a.i >= 0) || b.remaining - a.remaining);

  const il = $('#installments');
  if (!list.length) { il.innerHTML = '<div class="none">Nenhuma compra parcelada em andamento.</div>'; return; }
  il.innerHTML = list.map(x => {
    const p = personById(x.t.person);
    const last = addMonths(x.first, x.n - 1);
    const status = x.i < 0
      ? `começa em ${monthName(x.first, true)}`
      : `parcela ${x.i + 1} de ${x.n} · termina em ${monthName(last, true)}`;
    const ticks = Array.from({ length: x.n }, (_, k) =>
      `<i class="${k < x.i ? 'paid' : k === x.i ? 'now' : ''}"></i>`).join('');
    return `
      <div class="inst" data-id="${x.t.id}">
        <div class="inst-title"><i class="swatch" style="width:8px;height:8px;border-radius:50%;background:${p.color}"></i>
          <span>${esc(x.t.desc)}</span></div>
        <div class="inst-val">${money(installmentValue(x.t, Math.max(0, x.i)))}/mês</div>
        <div class="inst-meta">${esc(p.name)} · ${status}</div>
        <div class="inst-meta" style="text-align:right">faltam ${money(x.remaining)}</div>
        <div class="inst-prog">${ticks}</div>
      </div>`;
  }).join('');
  il.querySelectorAll('.inst').forEach(r => r.onclick = () => openTx(r.dataset.id));
}

// Quanto do limite está preso: tudo que ainda vai cair em faturas a partir do mês aberto.
function committedOn(cardId) {
  let sum = 0;
  for (const t of state.tx) {
    if (!isCredit(t) || t.cardId !== cardId) continue;
    const first = billMonth(t.date, cardById(t.cardId));
    if (t.recurring) {
      if (ui.month >= first && (!t.endMonth || ui.month <= t.endMonth)) sum += t.amount;
      continue;
    }
    const n = t.installments || 1;
    const i = monthDiff(first, ui.month);
    for (let k = Math.max(0, i); k < n; k++) sum += installmentValue(t, k);
  }
  return round2(sum);
}

const METHOD_LABEL = {
  pix: 'Pix', debito: 'Débito', credito: 'Crédito', dinheiro: 'Dinheiro', boleto: 'Boleto', transferencia: 'Transferência',
};

function renderTxList(occ) {
  const q = ui.search.trim().toLowerCase();
  const rows = occ
    .filter(o => ui.type === 'all' || o.t.type === ui.type)
    .filter(o => !q || `${o.t.desc} ${o.t.category}`.toLowerCase().includes(q))
    .sort((a, b) => b.day - a.day || b.amount - a.amount);
  const el = $('#txList');
  if (!rows.length) { el.innerHTML = '<div class="none">Nada por aqui neste mês.</div>'; return; }
  el.innerHTML = rows.map(o => {
    const t = o.t;
    const p = personById(t.person);
    const isIn = t.type === 'entrada';
    const tags = [
      `<span class="tag person"><i style="background:${p.color}"></i>${esc(p.name)}</span>`,
      `<span class="tag">${esc(t.category)}</span>`,
      isCredit(t) ? `<span class="tag card">💳 ${esc(cardById(t.cardId)?.name || 'Cartão')}</span>`
        : t.method ? `<span>${METHOD_LABEL[t.method] || ''}</span>` : '',
      o.part ? `<span class="tag card">parcela ${o.part[0]}/${o.part[1]}</span>` : '',
      t.recurring ? '<span class="tag">↻ todo mês</span>' : '',
    ].join('');
    const dateTxt = isCredit(t) && !t.recurring && o.part && o.part[0] > 1
      ? `compra<br>${pad(dayOf(t.date))}/${t.date.slice(5, 7)}`
      : `<strong>${pad(o.day)}</strong>${MONTHS[Number(ui.month.slice(5)) - 1].slice(0, 3)}`;
    return `
      <div class="tx" data-id="${t.id}">
        <div class="tx-date">${dateTxt}</div>
        <div style="min-width:0">
          <div class="tx-desc">${esc(t.desc)}</div>
          <div class="tx-meta">${tags}</div>
        </div>
        <div class="tx-amt ${isIn ? 'pos' : ''}">${isIn ? '+' : '−'} ${money(o.amount)}</div>
      </div>`;
  }).join('');
  el.querySelectorAll('.tx').forEach(r => r.onclick = () => openTx(r.dataset.id));
}

/* ------------------------------------------------------------------ *
 * Gráfico de barras verticais (SVG) com tooltip
 * ------------------------------------------------------------------ */

// Passo "redondo" para 4 linhas de grade (1, 2, 2,5 ou 5 × 10^k).
function niceStep(max) {
  if (max <= 0) return 25;
  const raw = max / 4;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}

function barChart(el, months, series, data, opts = {}) {
  const W = Math.max(280, el.clientWidth || 600);
  const H = el.classList.contains('small-trend') ? 180 : 240;
  const m = { l: W < 480 ? 50 : 62, r: 8, t: opts.labels && W >= 480 ? 22 : 10, b: 28 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const top = Math.max(0, ...data.flat());
  const step = niceStep(top);
  const lines = Math.max(1, Math.ceil(top / step));
  const max = step * lines;
  const y = v => m.t + ph - (v / max) * ph;
  const gw = pw / months.length;
  const bw = Math.min(30, (gw * 0.6 - (series.length - 1) * 2) / series.length);
  const groupW = bw * series.length + (series.length - 1) * 2;

  let s = `<svg viewBox="0 0 ${W} ${H}" role="img">`;
  for (let k = 0; k <= lines; k++) {
    const v = step * k, yy = y(v);
    s += `<line class="${k ? 'gridline' : 'baseline'}" x1="${m.l}" x2="${W - m.r}" y1="${yy}" y2="${yy}"/>`;
    s += `<text class="tick" x="${m.l - 8}" y="${yy + 4}" text-anchor="end">${moneyShort(v)}</text>`;
  }
  months.forEach((mo, i) => {
    const gx = m.l + gw * i + (gw - groupW) / 2;
    series.forEach((ser, j) => {
      const v = data[i][j];
      if (v <= 0) return;
      const x = gx + j * (bw + 2), top = y(v), h = m.t + ph - top;
      const r = Math.min(4, h, bw / 2);
      s += `<path fill="${ser.color}" d="M${x},${m.t + ph} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${m.t + ph} Z"/>`;
    });
    if (opts.labels && gw >= 56 && data[i][0] > 0) {
      s += `<text class="vlabel" x="${m.l + gw * i + gw / 2}" y="${y(data[i][0]) - 6}" text-anchor="middle">${moneyShort(data[i][0])}</text>`;
    }
    s += `<text class="xlabel ${mo === opts.current ? 'current' : ''}" x="${m.l + gw * i + gw / 2}" y="${H - 8}" text-anchor="middle">${monthName(mo, true)}</text>`;
    s += `<rect class="hit" data-i="${i}" x="${m.l + gw * i}" y="${m.t}" width="${gw}" height="${ph}" rx="6"/>`;
  });
  s += '</svg>';
  el.innerHTML = s;
  el.querySelectorAll('.hit').forEach(r => {
    const i = +r.dataset.i;
    bindTip(r, () => `<div class="tt-title">${monthName(months[i])}</div>` +
      series.map((ser, j) => `<div class="tt-row"><span><i style="background:${ser.color}"></i>${ser.label}</span><b>${money(data[i][j])}</b></div>`).join('') +
      (opts.extra ? opts.extra(months[i], i) : ''));
    r.addEventListener('click', () => { ui.month = months[i]; render(); });
  });
}

/* ------------------------------------------------------------------ *
 * Tooltip
 * ------------------------------------------------------------------ */

const tip = $('#tooltip');
function bindTip(el, html) {
  el.addEventListener('mouseenter', () => { tip.innerHTML = html(); tip.hidden = false; });
  el.addEventListener('mousemove', e => {
    const r = tip.getBoundingClientRect();
    let x = e.clientX + 14, yy = e.clientY + 14;
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
    if (yy + r.height > innerHeight - 8) yy = e.clientY - r.height - 14;
    tip.style.left = x + 'px'; tip.style.top = yy + 'px';
  });
  el.addEventListener('mouseleave', () => { tip.hidden = true; });
}

/* ------------------------------------------------------------------ *
 * Formulário de transação
 * ------------------------------------------------------------------ */

const txDialog = $('#txDialog');
const txForm = $('#txForm');
let editing = null;
let formType = 'saida';
let formPerson = null;

function setFormType(type) {
  formType = type;
  $('#txType').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === type));
  const sel = txForm.category;
  const cur = sel.value;
  sel.innerHTML = state.categories[type].map(c => `<option>${esc(c)}</option>`).join('');
  if (state.categories[type].includes(cur)) sel.value = cur;
  $('#methodField').querySelector('span').textContent = type === 'entrada' ? 'Como recebeu' : 'Forma de pagamento';
  txForm.method.querySelector('[value=credito]').hidden = type === 'entrada';
  if (type === 'entrada' && txForm.method.value === 'credito') txForm.method.value = 'pix';
  updateCreditFields();
}

function renderPersonChips() {
  $('#txPerson').innerHTML = state.people.map(p => `
    <button type="button" class="chip ${formPerson === p.id ? 'on' : ''}" data-id="${p.id}">
      <i class="swatch" style="background:${p.color}"></i>${esc(p.name)}</button>`).join('');
  $('#txPerson').querySelectorAll('button').forEach(b => b.onclick = () => { formPerson = b.dataset.id; renderPersonChips(); });
}

function updateCreditFields() {
  const credit = formType === 'saida' && txForm.method.value === 'credito';
  $('#creditFields').hidden = !credit;
  if (!credit) return;
  const recurring = txForm.recurring.checked;
  txForm.installments.disabled = recurring;
  if (recurring) txForm.installments.value = '1';
  const card = cardById(txForm.cardId.value);
  const n = Number(txForm.installments.value) || 1;
  const val = parseMoney(txForm.amount.value);
  const per = txForm.amountIsInstallment.checked ? val : val / n;
  const hint = $('#creditHint');
  if (!card || !txForm.date.value) { hint.textContent = ''; return; }
  const first = billMonth(txForm.date.value, card);
  let txt = `Entra na fatura de ${monthName(first)} (vence dia ${card.dueDay})`;
  if (n > 1) txt += ` até ${monthName(addMonths(first, n - 1))}`;
  if (n > 1 && Number.isFinite(per) && per > 0) txt += ` · ${n}x de ${money(per)} = ${money(per * n)}`;
  hint.textContent = txt + '.';
}

function openTx(id) {
  editing = id ? state.tx.find(t => t.id === id) : null;
  const t = editing;
  $('#txTitle').textContent = t ? 'Editar transação' : 'Nova transação';
  $('#txDelete').hidden = !t;
  $('#txStop').hidden = !(t && t.recurring);
  txForm.cardId.innerHTML = state.cards.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  txForm.installments.innerHTML = Array.from({ length: 24 }, (_, i) =>
    `<option value="${i + 1}">${i ? `${i + 1}x` : 'À vista (1x)'}</option>`).join('');

  formPerson = t ? t.person : (ui.person !== 'all' ? ui.person : state.people[0]?.id);
  txForm.desc.value = t ? t.desc : '';
  txForm.amount.value = t ? String(t.amount).replace('.', ',') : '';
  const today = todayISO();
  txForm.date.value = t ? t.date : (monthOf(today) === ui.month ? today : `${ui.month}-01`);
  txForm.method.value = t ? (t.method || 'pix') : 'pix';
  txForm.cardId.value = t?.cardId || state.cards[0]?.id || '';
  txForm.installments.value = String(t?.installments || 1);
  txForm.amountIsInstallment.checked = false;
  txForm.recurring.checked = !!t?.recurring;
  setFormType(t ? t.type : 'saida');
  if (t) txForm.category.value = t.category;
  renderPersonChips();
  txDialog.showModal();
  if (!t) txForm.desc.focus();
}

txForm.addEventListener('submit', e => {
  e.preventDefault();
  let amount = parseMoney(txForm.amount.value);
  if (!(amount > 0)) { txForm.amount.setCustomValidity('Digite um valor maior que zero'); txForm.amount.reportValidity(); return; }
  if (!formPerson) { alert('Escolha de quem é o lançamento.'); return; }
  const credit = formType === 'saida' && txForm.method.value === 'credito';
  const recurring = txForm.recurring.checked;
  const installments = credit && !recurring ? Number(txForm.installments.value) || 1 : 1;
  if (credit && installments > 1 && txForm.amountIsInstallment.checked) amount = amount * installments;

  const data = {
    type: formType,
    desc: txForm.desc.value.trim(),
    amount: round2(amount),
    date: txForm.date.value,
    category: txForm.category.value,
    person: formPerson,
    method: txForm.method.value,
    cardId: credit ? txForm.cardId.value : null,
    installments,
    recurring,
  };
  let saved = editing;
  if (editing) {
    Object.assign(editing, data);
    if (!recurring) delete editing.endMonth;
  } else {
    saved = { id: uid(), ...data };
    state.tx.push(saved);
  }
  save();
  txDialog.close();
  render();
  cloud.putTx(saved);
});

txForm.amount.addEventListener('input', () => { txForm.amount.setCustomValidity(''); updateCreditFields(); });
['method', 'cardId', 'installments', 'date', 'amountIsInstallment', 'recurring'].forEach(n =>
  txForm[n].addEventListener('change', updateCreditFields));
$('#txType').querySelectorAll('button').forEach(b => b.onclick = () => setFormType(b.dataset.v));

$('#txDelete').onclick = () => {
  if (!editing) return;
  const msg = editing.installments > 1
    ? `Excluir "${editing.desc}" e todas as ${editing.installments} parcelas?`
    : `Excluir "${editing.desc}"?`;
  if (!confirm(msg)) return;
  const id = editing.id;
  state.tx = state.tx.filter(t => t !== editing);
  save(); txDialog.close(); render();
  cloud.delTx(id);
};

$('#txStop').onclick = () => {
  if (!editing) return;
  const last = addMonths(ui.month, -1);
  if (!confirm(`Parar de repetir "${editing.desc}"? Fica até ${monthName(last)} e some a partir de ${monthName(ui.month)}.`)) return;
  editing.endMonth = last;
  save(); txDialog.close(); render();
  cloud.putTx(editing);
};

/* ------------------------------------------------------------------ *
 * Configurações
 * ------------------------------------------------------------------ */

const settingsDialog = $('#settingsDialog');
let draft = null;

function openSettings() {
  draft = JSON.parse(JSON.stringify({ people: state.people, cards: state.cards }));
  $('#catOut').value = state.categories.saida.join('\n');
  $('#catIn').value = state.categories.entrada.join('\n');
  renderSettingsLists();
  renderCloudSettings();
  settingsDialog.showModal();
}

async function renderCloudSettings() {
  const cfg = cloud.config();
  $('#cfgUrl').value = cfg.url;
  $('#cfgKey').value = cfg.key;
  $('#signOut').hidden = !cloud.user;
  $('#membersBox').hidden = !cloud.active;
  $('#cloudInfo').textContent = cloud.active
    ? `Conectado como ${cloud.user.email}. Tudo que você lança aparece na hora nos outros aparelhos.`
    : cloud.configured()
      ? 'Supabase configurado, mas você não entrou na conta. Os dados estão só neste navegador.'
      : 'Sem Supabase configurado: os dados ficam só neste navegador.';
  if (!cloud.active) return;
  const list = await cloud.members();
  $('#membersList').innerHTML = list.map(e => `
    <div class="member-row"><span>${esc(e)}${e === cloud.user.email.toLowerCase() ? ' <span class="muted">(você)</span>' : ''}</span>
      <button class="icon-btn" data-email="${esc(e)}" title="Remover acesso">✕</button></div>`).join('');
  $('#membersList').querySelectorAll('[data-email]').forEach(b => b.onclick = async () => {
    if (list.length === 1) { alert('Precisa ficar pelo menos uma pessoa com acesso.'); return; }
    if (!confirm(`Tirar o acesso de ${b.dataset.email}?`)) return;
    await cloud.removeMember(b.dataset.email);
    renderCloudSettings();
  });
}

$('#addMember').onclick = async () => {
  const email = $('#newMember').value.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { alert('Digite um e-mail válido.'); return; }
  if (await cloud.addMember(email)) { $('#newMember').value = ''; renderCloudSettings(); }
};
$('#saveCfg').onclick = () => { cloud.saveConfig($('#cfgUrl').value, $('#cfgKey').value); location.reload(); };
$('#signOut').onclick = () => cloud.signOut();

function renderSettingsLists() {
  $('#peopleEdit').innerHTML = draft.people.map((p, i) => `
    <div class="edit-row">
      <input type="color" value="${p.color}" data-i="${i}" data-k="color" class="input">
      <input class="input grow" value="${esc(p.name)}" data-i="${i}" data-k="name" placeholder="Nome">
      <button class="icon-btn" data-del="${i}" title="Remover">✕</button>
    </div>`).join('');
  $('#peopleEdit').querySelectorAll('input').forEach(inp => inp.oninput = () => { draft.people[inp.dataset.i][inp.dataset.k] = inp.value; });
  $('#peopleEdit').querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
    const p = draft.people[b.dataset.del];
    if (state.tx.some(t => t.person === p.id)) { alert(`${p.name} tem lançamentos. Mude o dono deles antes de remover.`); return; }
    draft.people.splice(b.dataset.del, 1); renderSettingsLists();
  });

  $('#cardsEdit').innerHTML = draft.cards.map((c, i) => `
    <div class="edit-row">
      <input class="input grow" value="${esc(c.name)}" data-i="${i}" data-k="name" placeholder="Nome do cartão">
      <span class="lbl">fecha dia</span><input class="input" style="width:64px" type="number" min="1" max="31" value="${c.closingDay}" data-i="${i}" data-k="closingDay">
      <span class="lbl">vence dia</span><input class="input" style="width:64px" type="number" min="1" max="31" value="${c.dueDay}" data-i="${i}" data-k="dueDay">
      <span class="lbl">limite</span><input class="input" style="width:110px" inputmode="decimal" value="${c.limit || ''}" data-i="${i}" data-k="limit">
      <button class="icon-btn" data-del="${i}" title="Remover">✕</button>
    </div>`).join('');
  $('#cardsEdit').querySelectorAll('input').forEach(inp => inp.oninput = () => {
    const k = inp.dataset.k;
    draft.cards[inp.dataset.i][k] = k === 'name' ? inp.value : k === 'limit' ? (parseMoney(inp.value) || 0) : Number(inp.value);
  });
  $('#cardsEdit').querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
    const c = draft.cards[b.dataset.del];
    if (state.tx.some(t => t.cardId === c.id)) { alert(`O cartão "${c.name}" tem compras lançadas. Remova ou mude essas compras antes.`); return; }
    draft.cards.splice(b.dataset.del, 1); renderSettingsLists();
  });
}

$('#addPerson').onclick = () => {
  draft.people.push({ id: uid(), name: '', color: PERSON_COLORS[draft.people.length % PERSON_COLORS.length] });
  renderSettingsLists();
};
$('#addCard').onclick = () => {
  draft.cards.push({ id: uid(), name: '', closingDay: 1, dueDay: 10, limit: 0 });
  renderSettingsLists();
};

$('#saveSettings').onclick = () => {
  const lines = id => [...new Set($(id).value.split('\n').map(s => s.trim()).filter(Boolean))];
  draft.people.forEach((p, i) => { p.name = p.name.trim() || `Pessoa ${i + 1}`; });
  draft.cards.forEach((c, i) => {
    c.name = c.name.trim() || `Cartão ${i + 1}`;
    c.closingDay = Math.min(31, Math.max(1, c.closingDay || 1));
    c.dueDay = Math.min(31, Math.max(1, c.dueDay || 10));
  });
  state.people = draft.people;
  state.cards = draft.cards;
  // Categorias em uso continuam disponíveis mesmo se apagadas da lista.
  for (const type of ['saida', 'entrada']) {
    const list = lines(type === 'saida' ? '#catOut' : '#catIn');
    const used = state.tx.filter(t => t.type === type).map(t => t.category);
    state.categories[type] = [...new Set([...(list.length ? list : ['Outros']), ...used])];
  }
  save(); settingsDialog.close(); render();
  cloud.saveSettings();
};

$('#exportData').onclick = () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `financas-backup-${todayISO()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

$('#importData').onchange = async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.tx) || !Array.isArray(data.people)) throw new Error('formato');
    if (!confirm(`Importar ${data.tx.length} lançamentos? Isso substitui os dados atuais.`)) return;
    state = Object.assign(DEFAULT_STATE(), data);
    save(); settingsDialog.close(); render();
    cloud.replaceAll();
  } catch (err) {
    alert('Não consegui ler esse arquivo. Use um backup exportado por aqui.');
  } finally { e.target.value = ''; }
};

$('#resetData').onclick = () => {
  if (!confirm('Apagar TODOS os lançamentos e configurações? Não dá pra desfazer.')) return;
  state = DEFAULT_STATE();
  save(); settingsDialog.close(); render();
  cloud.replaceAll();
};

/* ------------------------------------------------------------------ *
 * Dados de exemplo
 * ------------------------------------------------------------------ */

function loadDemo() {
  const s = DEFAULT_STATE();
  s.cards.push({ id: 'c2', name: 'Cartão do pai', closingDay: 25, dueDay: 5, limit: 8000 });
  const [me, dad, you] = s.people.map(p => p.id);
  const m = k => addMonths(monthOf(todayISO()), k);
  const add = (type, desc, amount, date, category, person, method, extra = {}) =>
    s.tx.push({ id: uid(), type, desc, amount, date, category, person, method,
      cardId: method === 'credito' ? (extra.cardId || 'c1') : null, installments: 1, recurring: false, ...extra });

  add('entrada', 'Salário', 3200, `${m(-5)}-05`, 'Salário', me, 'transferencia', { recurring: true });
  add('entrada', 'Aposentadoria', 2800, `${m(-5)}-02`, 'Salário', dad, 'transferencia', { recurring: true });
  add('entrada', 'Salário', 4100, `${m(-5)}-06`, 'Salário', you, 'transferencia', { recurring: true });
  add('saida', 'Aluguel', 1600, `${m(-5)}-10`, 'Casa', dad, 'boleto', { recurring: true });
  add('saida', 'Internet', 119.9, `${m(-5)}-15`, 'Contas (luz, água, internet)', you, 'debito', { recurring: true });
  add('saida', 'Streaming', 55.9, `${m(-5)}-08`, 'Assinaturas', me, 'credito', { recurring: true });
  add('saida', 'Academia', 99.9, `${m(-5)}-05`, 'Saúde', me, 'pix', { recurring: true });
  add('saida', 'Celular novo', 2400, `${m(-3)}-12`, 'Compras', me, 'credito', { installments: 10 });
  add('saida', 'Geladeira', 3600, `${m(-2)}-20`, 'Casa', dad, 'credito', { installments: 12, cardId: 'c2' });
  add('saida', 'Passagem de férias', 1350, `${m(-1)}-08`, 'Lazer', you, 'credito', { installments: 3 });
  add('saida', 'Curso de inglês', 1980, `${m(0)}-02`, 'Educação', me, 'credito', { installments: 6 });
  for (let k = -5; k <= 0; k++) {
    add('saida', 'Mercado', 480 + ((k * 37) % 90), `${m(k)}-07`, 'Mercado', dad, 'debito');
    add('saida', 'Conta de luz', 160 + ((k * 23) % 40), `${m(k)}-18`, 'Contas (luz, água, internet)', dad, 'pix');
    add('saida', 'Uber / ônibus', 140 + ((k * 13) % 50), `${m(k)}-21`, 'Transporte', me, 'credito');
    add('saida', 'Restaurantes', 210 + ((k * 31) % 120), `${m(k)}-14`, 'Alimentação fora', you, 'credito');
    add('saida', 'Farmácia', 65 + ((k * 17) % 45), `${m(k)}-11`, 'Saúde', dad, 'credito', { cardId: 'c2' });
  }
  add('entrada', 'Freela de design', 750, `${m(-1)}-22`, 'Freelance', me, 'pix');
  add('entrada', 'Pix da Maria (rachou o jantar)', 85, `${m(0)}-03`, 'Pix recebido', me, 'pix');
  state = s;
  save(); render();
  cloud.replaceAll();
}

/* ------------------------------------------------------------------ *
 * Ligações gerais
 * ------------------------------------------------------------------ */

$('#prevMonth').onclick = () => { ui.month = addMonths(ui.month, -1); render(); };
$('#nextMonth').onclick = () => { ui.month = addMonths(ui.month, 1); render(); };
$('#openNew').onclick = () => openTx();
$('#emptyNew').onclick = () => openTx();
$('#loadDemo').onclick = loadDemo;
$('#openSettings').onclick = openSettings;
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => b.closest('dialog').close());
$('#typeFilter').querySelectorAll('button').forEach(b => b.onclick = () => {
  ui.type = b.dataset.v;
  $('#typeFilter').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  render();
});
$('#search').addEventListener('input', e => { ui.search = e.target.value; renderTxList(occurrences(ui.month)); });
let resizeTimer;
addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(render, 150); });

render();
// cloud.start() é chamado no fim de sync.js
