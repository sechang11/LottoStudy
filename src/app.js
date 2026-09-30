/* Lottery Edge Lab: page behavior. Depends on window.LOTTO_DATA and window.LottoCore. */
(function () {
  'use strict';
  const D = window.LOTTO_DATA;
  const C = window.LottoCore;
  const $ = function (s, r) { return (r || document).querySelector(s); };
  const $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  const SVGNS = 'http://www.w3.org/2000/svg';

  /* ---------- models ---------- */
  const GAMES = {}, POP = {}, CROWD = {}, PAST = {};
  D.games.forEach(function (def) {
    const g = C.makeGame(def);
    GAMES[g.id] = g;
    const P = C.makePopularity(g, D.popularity[g.id]);
    POP[g.id] = P;
    const qp = C.crowdSample(P, 'uniform', 3000, 11);
    const self = C.crowdSample(P, 'self', 3000, 12);
    const smart = C.generateTickets(g, 30, 'smart', P, 2026, null);
    let anti = 0;
    smart.forEach(function (t) { anti += P.crowd(t.whites, t.bonus); });
    CROWD[g.id] = { qp: qp, self: self, anti: anti / smart.length, sortedQp: Float64Array.from(qp).sort() };
    const idx = new Map();
    D.draws[g.id].split(';').forEach(function (row) {
      const parts = row.split(':');
      const nums = parts[1].split(',').map(Number);
      const key = nums.slice(0, 5).sort(function (a, b) { return a - b; }).join('-');
      if (!idx.has(key)) idx.set(key, fmtDate(parts[0]));
    });
    PAST[g.id] = idx;
  });
  const STATES = D.states;

  /* ---------- formatting ---------- */
  function trimNum(v, d) {
    const s = v.toFixed(d);
    return d > 0 ? s.replace(/\.?0+$/, '') : s;
  }
  function moneyShort(x) {
    if (x >= 1e9) return '$' + trimNum(x / 1e9, 2) + 'B';
    if (x >= 1e6) return '$' + trimNum(x / 1e6, x >= 1e8 ? 0 : 1) + 'M';
    if (x >= 1e4) return '$' + Math.round(x / 1e3) + 'K';
    return '$' + Math.round(x).toLocaleString('en-US');
  }
  function cents(x) { return '$' + x.toFixed(2); }
  function countShort(x) {
    if (x >= 1e9) return trimNum(x / 1e9, 2) + ' billion';
    if (x >= 1e6) return trimNum(x / 1e6, x >= 1e8 ? 0 : 1) + ' million';
    return Math.round(x).toLocaleString('en-US');
  }
  function pct(x, d) { return (x * 100).toFixed(d == null ? 0 : d) + '%'; }
  function oneIn(p) { return '1 in ' + Math.round(1 / p).toLocaleString('en-US'); }
  function times(x) { return (x >= 10 ? Math.round(x) : x.toFixed(2)) + '×'; }
  function fmtDate(ymd) {
    const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return m[+ymd.slice(4, 6) - 1] + ' ' + (+ymd.slice(6, 8)) + ', ' + ymd.slice(0, 4);
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function setText(sel, txt) { const e = typeof sel === 'string' ? $(sel) : sel; if (e) e.textContent = txt; }

  /* ---------- tooltip ---------- */
  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.hidden = true;
  tip.setAttribute('role', 'status');
  document.body.appendChild(tip);
  function showTip(x, y, rows) {
    tip.textContent = '';
    rows.forEach(function (r) {
      const div = document.createElement('div');
      div.className = r.cls || '';
      if (r.key) {
        div.className = 'row';
        const i = document.createElement('i');
        i.style.background = r.key;
        div.appendChild(i);
        const b = document.createElement('b');
        b.textContent = r.value;
        div.appendChild(b);
        const s = document.createElement('span');
        s.textContent = r.label;
        s.className = 'muted';
        div.appendChild(s);
      } else div.textContent = r.text;
      tip.appendChild(div);
    });
    tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let left = x + 14, top = y + 14;
    if (left + w > window.innerWidth - 8) left = x - w - 14;
    if (top + h > window.innerHeight - 8) top = y - h - 14;
    tip.style.left = Math.max(8, left) + 'px';
    tip.style.top = Math.max(8, top) + 'px';
  }
  function hideTip() { tip.hidden = true; }
  function focusTip(el, rows) {
    const r = el.getBoundingClientRect();
    showTip(r.left + r.width / 2, r.top + r.height / 2, rows);
  }

  /* ---------- svg helpers ---------- */
  function svgEl(tag, attrs, parent) {
    const e = document.createElementNS(SVGNS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function niceTicks(min, max, count) {
    const span = max - min;
    const step0 = Math.pow(10, Math.floor(Math.log10(span / count)));
    const err = (count * step0) / span;
    const step = step0 * (err <= 0.15 ? 10 : err <= 0.35 ? 5 : err <= 0.75 ? 2 : 1);
    const out = [];
    for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(10));
    return out;
  }
  function onResize(el, fn) {
    let last = 0;
    if (window.ResizeObserver) {
      new ResizeObserver(function () {
        const w = Math.round(el.clientWidth);
        if (w !== last && w > 0) { last = w; fn(); }
      }).observe(el);
    } else window.addEventListener('resize', fn);
  }

  /* ---------- shared: EV for a configuration ---------- */
  function taxFor(stateCode, fedTop) {
    const s = STATES.find(function (x) { return x.code === stateCode; }) || STATES[0];
    return { fedTop: fedTop, fedMid: 0.24, state: s.rate, local: s.local || 0, name: s.name, short: s.short || s.name };
  }
  function crowdFor(id, pick) {
    return pick === 'self' ? CROWD[id].self : pick === 'anti' ? CROWD[id].anti : CROWD[id].qp;
  }

  /* =========================================================
     Hero: what tonight's ticket is worth
     ========================================================= */
  function initHero() {
    const g = GAMES.pb;
    const r = C.ticketEV(g, { annuity: g.current.annuity, cashRatio: g.current.cash / g.current.annuity, tax: taxFor('none', 0.37), crowd: CROWD.pb.qp });
    setText('#hero-ev', cents(r.total));
    setText('#hero-ret', pct(r.ret));
    $('#hero-meter').style.width = Math.min(100, r.ret * 100).toFixed(1) + '%';
    setText('#hero-jackpot', moneyShort(g.current.annuity));
    setText('#hero-lose', cents(g.price - r.total));
  }

  /* =========================================================
     Tool 1: ticket value
     ========================================================= */
  const V = { game: 'pb', annuity: null, state: 'none', pick: 'qp', cashPct: null, fed: 37, plays: null };
  const JMIN = { pb: 20e6, mm: 50e6 }, JMAX = 2.5e9;
  function sliderToAnnuity(id, s) { const a = Math.log(JMIN[id]), b = Math.log(JMAX); return Math.exp(a + (b - a) * (s / 1000)); }
  function annuityToSlider(id, x) { const a = Math.log(JMIN[id]), b = Math.log(JMAX); return Math.round(((Math.log(x) - a) / (b - a)) * 1000); }
  function roundJackpot(x) { return x >= 1e9 ? Math.round(x / 1e7) * 1e7 : x >= 1e8 ? Math.round(x / 1e6) * 1e6 : Math.round(x / 1e5) * 1e5; }

  function initValue() {
    const sel = $('#v-state');
    STATES.forEach(function (s) {
      const o = document.createElement('option');
      o.value = s.code;
      o.textContent = s.label;
      sel.appendChild(o);
    });
    sel.value = V.state;
    sel.addEventListener('change', function () { V.state = sel.value; renderValue(); });
    $$('#v-game button').forEach(function (b) {
      b.addEventListener('click', function () { setGame(b.dataset.game); });
    });
    $$('#v-pick button').forEach(function (b) {
      b.addEventListener('click', function () {
        V.pick = b.dataset.pick;
        $$('#v-pick button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        renderValue();
      });
    });
    $('#v-jackpot').addEventListener('input', function (e) {
      V.annuity = roundJackpot(sliderToAnnuity(V.game, +e.target.value));
      V.plays = null; $('#v-plays').value = '';
      renderValue();
    });
    $('#v-cash').addEventListener('input', function (e) { const v = +e.target.value; if (v > 5 && v <= 100) { V.cashPct = v; renderValue(); } });
    $('#v-fed').addEventListener('input', function (e) { const v = +e.target.value; if (v >= 0 && v <= 60) { V.fed = v; renderValue(); } });
    $('#v-plays').addEventListener('input', function (e) { const v = +e.target.value; V.plays = v > 0 ? v * 1e6 : null; renderValue(); });
    $$('[data-jp]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.dataset.game && b.dataset.game !== V.game) setGame(b.dataset.game, true);
        V.annuity = +b.dataset.jp; V.plays = null; $('#v-plays').value = '';
        $('#v-jackpot').value = annuityToSlider(V.game, V.annuity);
        renderValue();
      });
    });
    setGame('pb');
    onResize($('#v-chart'), renderValueChart);
  }
  function setGame(id, keepJackpot) {
    V.game = id;
    const g = GAMES[id];
    $$('#v-game button').forEach(function (x) { x.setAttribute('aria-pressed', String(x.dataset.game === id)); });
    if (!keepJackpot) V.annuity = g.current.annuity;
    V.cashPct = Math.round((g.current.cash / g.current.annuity) * 1000) / 10;
    $('#v-cash').value = V.cashPct;
    V.plays = null; $('#v-plays').value = '';
    $('#v-jackpot').value = annuityToSlider(id, V.annuity);
    $$('.pb-only').forEach(function (e) { e.hidden = id !== 'pb'; });
    $$('.mm-only').forEach(function (e) { e.hidden = id !== 'mm'; });
    renderValue();
  }
  function evAt(id, annuity, pick, plays) {
    const g = GAMES[id];
    return C.ticketEV(g, { annuity: annuity, cashRatio: V.cashPct / 100, tax: taxFor(V.state, V.fed / 100), crowd: crowdFor(id, pick), plays: plays || undefined });
  }
  function renderValue() {
    const id = V.game, g = GAMES[id];
    const tax = taxFor(V.state, V.fed / 100);
    const r = evAt(id, V.annuity, V.pick, V.plays);
    setText('#v-jackpot-val', moneyShort(V.annuity));
    $('#v-plays').placeholder = (r.plays / 1e6).toFixed(1) + ' (estimated)';
    setText('#v-ev', cents(r.total));
    setText('#v-price', cents(g.price));
    setText('#v-ret', pct(r.ret) + ' back');
    setText('#v-lose', cents(g.price - r.total));

    // waterfall
    const steps = [
      { lab: 'Advertised jackpot (paid over 30 years)', v: V.annuity },
      { lab: 'Cash option (its value today)', v: r.cash },
      { lab: 'After taxes (' + pct(tax.fedTop + tax.state + tax.local, 1).replace('.0%', '%') + ')', v: r.cashAfterTax },
      { lab: 'What you should expect to keep if you win, after splits', v: r.expectedPrizeIfWin }
    ];
    const falls = $('#v-falls');
    falls.textContent = '';
    steps.forEach(function (s, i) {
      const row = document.createElement('div'); row.className = 'fall';
      const lab = document.createElement('div'); lab.className = 'lab'; lab.textContent = s.lab;
      const bar = document.createElement('div'); bar.className = 'bar';
      const fill = document.createElement('span');
      fill.style.width = Math.max(0.5, (s.v / V.annuity) * 100).toFixed(2) + '%';
      fill.style.background = i === 3 ? 'var(--dropout)' : 'var(--s-qp)';
      bar.appendChild(fill);
      const val = document.createElement('div'); val.className = 'val'; val.textContent = moneyShort(s.v);
      row.appendChild(lab); row.appendChild(bar); row.appendChild(val);
      falls.appendChild(row);
    });
    const pSplit = 1 - expectedNoSplit(r.lambdaBar, crowdFor(id, V.pick));
    setText('#v-odds', oneIn(1 / g.combos));
    setText('#v-plays-out', countShort(r.plays));
    setText('#v-split', pct(pSplit, pSplit < 0.1 ? 1 : 0));
    setText('#v-lower', cents(r.lowerEV));
    setText('#v-jpev', cents(r.jpEV));

    // answer: does it ever pay?
    const grid = annuityGrid(id, 160);
    let best = { ev: -1, a: 0 };
    grid.forEach(function (a) { const e = evAt(id, a, V.pick).total; if (e > best.ev) best = { ev: e, a: a }; });
    const pickName = { qp: 'quick-pick', self: 'self-picked', anti: 'crowd-avoiding' }[V.pick];
    const ans = $('#v-answer');
    ans.textContent = '';
    const strong = document.createElement('strong');
    if (best.ev < g.price) {
      strong.textContent = 'Never, for a ' + pickName + ' ticket in ' + tax.short + '. ';
      ans.appendChild(strong);
      ans.appendChild(document.createTextNode(best.a < JMAX * 0.97
        ? 'Its value tops out around ' + cents(best.ev) + ' (' + pct(best.ev / g.price) + ' of the ' + cents(g.price) + ' price) when the advertised jackpot is near ' + moneyShort(best.a) + '. Bigger jackpots make it worse, because ticket sales climb faster than the jackpot and splits become likely.'
        : 'Even at a ' + moneyShort(JMAX) + ' jackpot, bigger than any ever offered, it would be worth about ' + cents(best.ev) + ' (' + pct(best.ev / g.price) + ' of the ' + cents(g.price) + ' price). Taxes take over a third of the jackpot, and at that size you should expect to share it.'));
    } else {
      let first = null;
      grid.forEach(function (a) { if (first === null && evAt(id, a, V.pick).total >= g.price) first = a; });
      strong.textContent = 'Only on paper, above roughly ' + moneyShort(first) + '. ';
      ans.appendChild(strong);
      ans.appendChild(document.createTextNode('With these assumptions a ticket is worth slightly more than it costs there. See the next box for why that still is not a reason to buy many.'));
    }

    // Kelly: the best case imaginable
    renderKelly(id);
    // add-on
    if (id === 'pb') {
      const ad = C.addonEV(g, V.annuity, tax);
      setText('#v-addon', 'Power Play costs $1 more and pays back about ' + cents(ad.post) + ' of it on average (' + cents(ad.pre) + ' before tax). It never touches the jackpot.');
    } else {
      setText('#v-addon', 'Every $5 Mega Millions play includes a random 2× to 10× multiplier on non-jackpot prizes. It averages exactly 3×, and it is already counted in the smaller-prize value above.');
    }
    renderValueChart();
  }
  function expectedNoSplit(lambdaBar, crowd) {
    if (typeof crowd === 'number') return Math.exp(-lambdaBar * crowd);
    let s = 0;
    for (let i = 0; i < crowd.length; i++) s += Math.exp(-lambdaBar * crowd[i]);
    return s / crowd.length;
  }
  function annuityGrid(id, n) {
    const out = [], a = Math.log(JMIN[id]), b = Math.log(JMAX);
    for (let i = 0; i < n; i++) out.push(Math.exp(a + ((b - a) * i) / (n - 1)));
    return out;
  }
  // Build a sentence from parts; {b: 'text'} parts render bold. Keeps data out of innerHTML.
  function writeRich(el, parts) {
    el.textContent = '';
    parts.forEach(function (p) {
      if (typeof p === 'string') el.appendChild(document.createTextNode(p));
      else { const b = document.createElement('b'); b.textContent = p.b; el.appendChild(b); }
    });
  }
  function renderKelly(id) {
    const g = GAMES[id];
    const rec = g.records[0];
    // best case: no tax, nobody to split with, record jackpot
    const lower = C.lowerTierEV(g, null, g.multiplier);
    const outcomes = [{ p: 1 / g.combos, payoff: rec.cash }];
    lower.byTier.forEach(function (t) { outcomes.push({ p: t.p, payoff: t.prize }); });
    const ev = outcomes.reduce(function (s, o) { return s + o.p * o.payoff; }, 0);
    const W = C.kellyMinBankroll(outcomes, g.price);
    const cur = evAt(id, V.annuity, V.pick, V.plays).total;
    const recTxt = moneyShort(rec.annuity) + ' record jackpot (' + moneyShort(rec.cash) + ' cash, ' + rec.year + ')';
    const parts = cur < g.price
      ? ['Zero, if you are counting money. Each ticket loses about ', { b: cents(g.price - cur) }, ' on average, and every extra ticket loses the same amount. ']
      : ['With these settings a ticket is worth a little more than its price, but that is not a reason to buy many. '];
    if (isFinite(W)) {
      parts.push('Now take the best case imaginable: the ' + recTxt + ', no taxes at all and nobody to split with. A ticket would be worth ',
        { b: cents(ev) }, ', more than its ' + cents(g.price) + ' price. Even then, the Kelly criterion (the standard formula for sizing a bet you have an edge on) says you would need about ',
        { b: moneyShort(W) }, ' in the bank before one single ticket is the right-sized bet. Nearly all of a ticket’s value sits in one outcome with odds of about 1 in ' +
        Math.round(g.combos / 1e6) + ' million, and no normal bankroll can carry that risk.');
    } else {
      parts.push('Even the best case imaginable doesn’t get there: the ' + recTxt + ', with no taxes and nobody to split with, would make a ' + cents(g.price) + ' ticket worth only ',
        { b: cents(ev) }, '. So the Kelly criterion (the standard formula for sizing a bet you have an edge on) says to bet nothing at any bankroll.');
    }
    writeRich($('#k-text'), parts);
  }
  function renderValueChart() {
    const box = $('#v-chart');
    const id = V.game, g = GAMES[id];
    const W = Math.max(300, box.clientWidth), H = W < 520 ? 260 : 300;
    const m = { l: 46, r: 14, t: 16, b: 34 };
    const grid = annuityGrid(id, 90);
    const picks = [
      { key: 'qp', name: 'Quick pick', color: cssVar('--s-qp') },
      { key: 'self', name: 'Your own favorites', color: cssVar('--s-fav') },
      { key: 'anti', name: 'Crowd-avoiding', color: cssVar('--s-anti') }
    ];
    const series = picks.map(function (p) { return grid.map(function (a) { return evAt(id, a, p.key).total; }); });
    let yMax = g.price * 1.12;
    series.forEach(function (s) { s.forEach(function (v) { if (v > yMax) yMax = v * 1.05; }); });
    const x = function (a) { return m.l + ((Math.log(a) - Math.log(JMIN[id])) / (Math.log(JMAX) - Math.log(JMIN[id]))) * (W - m.l - m.r); };
    const y = function (v) { return m.t + (1 - v / yMax) * (H - m.t - m.b); };
    box.textContent = '';
    const svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, role: 'img', 'aria-label': 'Line chart of ticket value against jackpot size for three ways of picking numbers' }, box);
    // grid + y axis
    niceTicks(0, yMax, 5).forEach(function (t) {
      svgEl('line', { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t), stroke: cssVar('--grid'), 'stroke-width': 1 }, svg);
      const tx = svgEl('text', { x: m.l - 8, y: y(t) + 4, 'text-anchor': 'end', fill: cssVar('--ink-3'), 'font-size': 11 }, svg);
      tx.textContent = '$' + (t % 1 ? t.toFixed(2) : t.toFixed(0));
    });
    // x ticks
    [20e6, 50e6, 100e6, 250e6, 500e6, 1e9, 2e9].filter(function (t) { return t >= JMIN[id]; }).forEach(function (t) {
      const tx = svgEl('text', { x: x(t), y: H - m.b + 18, 'text-anchor': 'middle', fill: cssVar('--ink-3'), 'font-size': 11 }, svg);
      tx.textContent = moneyShort(t);
      svgEl('line', { x1: x(t), x2: x(t), y1: H - m.b, y2: H - m.b + 4, stroke: cssVar('--axis') }, svg);
    });
    svgEl('line', { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, stroke: cssVar('--axis') }, svg);
    // break-even line
    svgEl('line', { x1: m.l, x2: W - m.r, y1: y(g.price), y2: y(g.price), stroke: cssVar('--ink'), 'stroke-width': 1.5 }, svg);
    const be = svgEl('text', { x: m.l + 6, y: y(g.price) - 7, fill: cssVar('--ink'), 'font-size': 12, 'font-weight': 700, stroke: cssVar('--slip'), 'stroke-width': 4, 'paint-order': 'stroke', 'stroke-linejoin': 'round' }, svg);
    be.textContent = 'Ticket price ' + cents(g.price) + ' (break-even)';
    // current jackpot marker
    const cx = x(V.annuity);
    svgEl('line', { x1: cx, x2: cx, y1: m.t, y2: H - m.b, stroke: cssVar('--dropout'), 'stroke-width': 1 }, svg);
    const cl = svgEl('text', { x: cx + (cx > W * 0.7 ? -6 : 6), y: H - m.b - 8, 'text-anchor': cx > W * 0.7 ? 'end' : 'start', fill: cssVar('--dropout'), 'font-size': 11, 'font-weight': 700, stroke: cssVar('--slip'), 'stroke-width': 4, 'paint-order': 'stroke', 'stroke-linejoin': 'round' }, svg);
    cl.textContent = moneyShort(V.annuity);
    // lines
    const order = [0, 1, 2].filter(function (i) { return picks[i].key !== V.pick; }).concat([picks.findIndex(function (p) { return p.key === V.pick; })]);
    order.forEach(function (si) {
      const s = series[si];
      let d = '';
      s.forEach(function (v, i) { d += (i ? 'L' : 'M') + x(grid[i]).toFixed(1) + ' ' + y(v).toFixed(1); });
      svgEl('path', { d: d, fill: 'none', stroke: picks[si].color, 'stroke-width': V.pick === picks[si].key ? 2.5 : 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', opacity: V.pick === picks[si].key ? 1 : 0.75 }, svg);
    });
    // markers at the current jackpot, selected strategy
    const cur = evAt(id, V.annuity, V.pick, V.plays).total;
    const selColor = picks.find(function (p) { return p.key === V.pick; }).color;
    svgEl('circle', { cx: cx, cy: y(cur), r: 5, fill: selColor, stroke: cssVar('--slip'), 'stroke-width': 2 }, svg);
    // hover layer
    const hl = svgEl('line', { x1: 0, x2: 0, y1: m.t, y2: H - m.b, stroke: cssVar('--ink-3'), 'stroke-width': 1, visibility: 'hidden' }, svg);
    const hit = svgEl('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: 'transparent', tabindex: 0 }, svg);
    function at(clientX) {
      const bb = svg.getBoundingClientRect();
      const px = ((clientX - bb.left) / bb.width) * W;
      let bi = 0, bd = Infinity;
      grid.forEach(function (a, i) { const d = Math.abs(x(a) - px); if (d < bd) { bd = d; bi = i; } });
      return bi;
    }
    function show(i, cxp, cyp) {
      hl.setAttribute('x1', x(grid[i])); hl.setAttribute('x2', x(grid[i])); hl.setAttribute('visibility', 'visible');
      const rows = [{ text: 'Advertised jackpot ' + moneyShort(grid[i]) }];
      picks.forEach(function (p, si) { rows.push({ key: p.color, value: cents(series[si][i]), label: p.name }); });
      showTip(cxp, cyp, rows);
    }
    hit.addEventListener('pointermove', function (e) { show(at(e.clientX), e.clientX, e.clientY); });
    hit.addEventListener('pointerleave', function () { hl.setAttribute('visibility', 'hidden'); hideTip(); });
    hit.addEventListener('focus', function () { const i = grid.findIndex(function (a) { return a >= V.annuity; }); const bb = svg.getBoundingClientRect(); show(Math.max(0, i), bb.left + (x(grid[Math.max(0, i)]) / W) * bb.width, bb.top + 20); });
    hit.addEventListener('blur', function () { hl.setAttribute('visibility', 'hidden'); hideTip(); });

    // table view
    const tb = $('#v-table');
    tb.textContent = '';
    const head = document.createElement('tr');
    ['Advertised jackpot'].concat(picks.map(function (p) { return p.name; })).forEach(function (h) { const th = document.createElement('th'); th.textContent = h; head.appendChild(th); });
    tb.appendChild(head);
    [50e6, 100e6, 250e6, 500e6, 1e9, 1.5e9, 2e9, 2.5e9].forEach(function (a) {
      if (a < JMIN[id]) return;
      const tr = document.createElement('tr');
      const td0 = document.createElement('td'); td0.textContent = moneyShort(a); tr.appendChild(td0);
      picks.forEach(function (p) { const td = document.createElement('td'); td.textContent = cents(evAt(id, a, p.key).total); tr.appendChild(td); });
      tb.appendChild(tr);
    });
  }

  /* =========================================================
     Tool 2: spread builder
     ========================================================= */
  const S = { game: 'pb', n: 10, mode: 'smart', seed: 20260930 };
  const MODE_NAMES = { smart: 'Crowd-avoiding spread', spread: 'Spread only', random: 'Quick picks' };
  function initSpread() {
    $$('#s-game button').forEach(function (b) {
      b.addEventListener('click', function () {
        S.game = b.dataset.game;
        $$('#s-game button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        renderSpread();
      });
    });
    $$('#s-mode button').forEach(function (b) {
      b.addEventListener('click', function () {
        S.mode = b.dataset.mode;
        $$('#s-mode button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        renderSpread();
      });
    });
    const rng = $('#s-n'), num = $('#s-n-num');
    let t = null;
    function setN(v) {
      S.n = Math.max(1, Math.min(50, Math.round(v) || 1));
      rng.value = S.n; num.value = S.n;
      clearTimeout(t); t = setTimeout(renderSpread, 60);
    }
    rng.addEventListener('input', function () { setN(+rng.value); });
    num.addEventListener('change', function () { setN(+num.value); });
    $('#s-regen').addEventListener('click', function () { S.seed = (S.seed * 1103515245 + 12345) >>> 0; renderSpread(); });
    $('#s-copy').addEventListener('click', function () {
      const txt = $('#s-ticket').dataset.plain || '';
      const done = function () { setText('#s-copy', 'Copied'); setTimeout(function () { setText('#s-copy', 'Copy numbers'); }, 1600); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(done, function () { selectTicket(); });
      } else selectTicket();
    });
    renderSpread();
  }
  function selectTicket() {
    const r = document.createRange();
    r.selectNodeContents($('#s-list'));
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    setText('#s-copy', 'Selected. Press Ctrl+C');
  }
  function letters(i) { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  function renderSpread() {
    const g = GAMES[S.game], P = POP[S.game];
    const sets = {};
    ['smart', 'spread', 'random'].forEach(function (mode) {
      const tickets = C.generateTickets(g, S.n, mode, P, S.seed + (mode === 'random' ? 7 : 0), PAST[S.game]);
      sets[mode] = { tickets: tickets, stats: C.ticketSetStats(g, tickets, P, 40000, 31) };
    });
    const cur = sets[S.mode];
    // ticket printout
    const list = $('#s-list');
    list.textContent = '';
    const plain = [g.name.toUpperCase() + ' - ' + S.n + ' play' + (S.n > 1 ? 's' : '') + ' (' + MODE_NAMES[S.mode] + ')'];
    cur.tickets.forEach(function (t, i) {
      const li = document.createElement('li');
      const a = document.createElement('span'); a.className = 'lt'; a.textContent = letters(i);
      const wb = document.createElement('span'); wb.className = 'wb'; wb.textContent = t.whites.map(pad2).join(' ');
      const pb = document.createElement('span'); pb.className = 'pb'; pb.textContent = (S.game === 'pb' ? 'PB ' : 'MB ') + pad2(t.bonus);
      li.appendChild(a); li.appendChild(wb); li.appendChild(pb);
      list.appendChild(li);
      plain.push(letters(i) + '. ' + t.whites.map(pad2).join(' ') + '  ' + (S.game === 'pb' ? 'PB ' : 'MB ') + pad2(t.bonus));
    });
    $('#s-ticket').dataset.plain = plain.join('\n');
    setText('#s-t-game', g.name);
    setText('#s-t-style', MODE_NAMES[S.mode]);
    setText('#s-t-cost', 'Cost ' + '$' + (S.n * g.price).toFixed(2));
    setText('#s-t-plays', S.n + ' play' + (S.n > 1 ? 's' : ''));
    // stats
    const st = cur.stats;
    setText('#s-jp', oneIn(st.pJackpot));
    setText('#s-any', pct(st.pAny, 1));
    setText('#s-any-qp', 'Quick picks: ' + pct(sets.random.stats.pAny, 1));
    setText('#s-overlap', st.maxOverlap <= 1 ? (S.n === 1 ? 'n/a' : st.maxOverlap === 0 ? 'None' : 'At most 1') : 'Up to ' + st.maxOverlap);
    setText('#s-overlap-d', S.n === 1 ? 'Only one ticket' : st.sharedPairs === 0 ? 'No two tickets share 2+ white balls' : st.sharedPairs === 1 ? 'One pair of tickets shares 2 white balls' : st.sharedPairs + ' pairs of tickets share 2+ white balls');
    setText('#s-bonus', st.bonusesCovered + ' of ' + g.bonus);
    setText('#s-bonus-k', g.bonusName + 's covered');
    setText('#s-crowd', times(st.meanCrowd));
    // comparison table
    const tb = $('#s-compare');
    tb.textContent = '';
    const hr = document.createElement('tr');
    ['Style', 'Win anything', 'Match 3+ whites on some ticket', 'Most whites shared', 'Crowd factor'].forEach(function (h) { const th = document.createElement('th'); th.textContent = h; hr.appendChild(th); });
    tb.appendChild(hr);
    ['smart', 'spread', 'random'].forEach(function (mode) {
      const s2 = sets[mode].stats;
      const tr = document.createElement('tr');
      if (mode === S.mode) tr.style.fontWeight = '700';
      [MODE_NAMES[mode], pct(s2.pAny, 1), pct(s2.pGe3, 1), S.n === 1 ? 'n/a' : String(s2.maxOverlap), times(s2.meanCrowd)].forEach(function (v) {
        const td = document.createElement('td'); td.textContent = v; tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    // expected value is identical: say so with numbers
    const lower = C.lowerTierEV(g, null, g.multiplier).pre;
    setText('#s-same', 'Every style has the same expected payout from fixed prizes: ' + cents(lower * S.n) + ' back on ' + '$' + (S.n * g.price).toFixed(2) + ' spent, before the jackpot.');
  }

  /* =========================================================
     Tool 3: crowd check
     ========================================================= */
  const K = { game: 'pb' };
  const PRESETS = {
    pb: [
      { label: 'Birthday ticket', w: [3, 7, 12, 19, 25], b: 7 },
      { label: '1 2 3 4 5', w: [1, 2, 3, 4, 5], b: 6 },
      { label: '“Lost” numbers', w: [4, 8, 15, 16, 23], b: 22 },
      { label: 'Last draw', last: true },
      { label: 'Random quick pick', random: true },
      { label: 'Crowd-avoiding pick', smart: true }
    ]
  };
  PRESETS.mm = PRESETS.pb;
  function initCheck() {
    $$('#c-game button').forEach(function (b) {
      b.addEventListener('click', function () {
        K.game = b.dataset.game;
        $$('#c-game button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        const g = GAMES[K.game];
        $$('#c-picks input.white').forEach(function (inp) { inp.max = g.whites; });
        $('#c-bonus').max = g.bonus;
        setText('#c-bonus-label', g.bonusName);
        if (+$('#c-bonus').value > g.bonus) $('#c-bonus').value = g.bonus;
        renderCheck();
      });
    });
    const chips = $('#c-presets');
    PRESETS.pb.forEach(function (p) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'chip'; b.textContent = p.label;
      b.addEventListener('click', function () { applyPreset(p); });
      chips.appendChild(b);
    });
    $$('#c-picks input').forEach(function (inp) { inp.addEventListener('input', renderCheck); });
    applyPreset(PRESETS.pb[0]);
  }
  let presetSeed = 5;
  function applyPreset(p) {
    const g = GAMES[K.game];
    let w = p.w, b = p.b;
    if (p.last) {
      const rows = D.draws[K.game].split(';');
      const nums = rows[rows.length - 1].split(':')[1].split(',').map(Number);
      w = nums.slice(0, 5); b = nums[5];
    } else if (p.random) {
      const rng = C.mulberry32(presetSeed++ * 7919);
      const t = POP[K.game].sampleUniform(rng); w = t.whites; b = t.bonus;
    } else if (p.smart) {
      const t = C.generateTickets(g, 1, 'smart', POP[K.game], presetSeed++ * 104729, PAST[K.game])[0]; w = t.whites; b = t.bonus;
    }
    if (b > g.bonus) b = g.bonus;
    $$('#c-picks input.white').forEach(function (inp, i) { inp.value = w[i]; });
    $('#c-bonus').value = b;
    renderCheck();
  }
  function renderCheck() {
    const g = GAMES[K.game], P = POP[K.game];
    const whites = $$('#c-picks input.white').map(function (i) { return Math.round(+i.value); });
    const bonus = Math.round(+$('#c-bonus').value);
    const err = $('#c-error');
    const bad = whites.some(function (x) { return !(x >= 1 && x <= g.whites); }) || !(bonus >= 1 && bonus <= g.bonus);
    const dup = new Set(whites).size !== 5;
    $('#c-result').hidden = bad || dup;
    err.hidden = !(bad || dup);
    if (bad) { err.textContent = 'White balls go from 1 to ' + g.whites + ' and the ' + g.bonusName + ' from 1 to ' + g.bonus + '.'; return; }
    if (dup) { err.textContent = 'The five white balls must all be different.'; return; }
    const crowd = P.crowd(whites, bonus);
    const sorted = CROWD[K.game].sortedQp;
    let lo = 0, hi = sorted.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < crowd) lo = mid + 1; else hi = mid; }
    const pctile = lo / sorted.length;
    setText('#c-factor', times(crowd));
    const pc = function (x) { return x >= 0.995 ? '99%+' : pct(x); };
    setText('#c-pctile', pctile >= 0.5 ? 'More crowded than ' + pc(pctile) + ' of all possible tickets' : 'Less crowded than ' + pc(1 - pctile) + ' of all possible tickets');
    // expected co-winners at current jackpot and at a record-size jackpot
    const cur = g.current.annuity, rec = g.records[0].annuity;
    const nowPlays = C.playsFor(g, cur), recPlays = C.playsFor(g, rec);
    const lamNow = (nowPlays / g.combos) * crowd, lamRec = (recPlays / g.combos) * crowd;
    const antiNow = (recPlays / g.combos) * CROWD[K.game].anti;
    setText('#c-now', lamNow < 0.1 ? lamNow.toFixed(3) : lamNow.toFixed(2));
    setText('#c-now-k', 'Other winners to expect at the current ' + moneyShort(cur) + ' jackpot');
    setText('#c-rec', lamRec.toFixed(2));
    setText('#c-rec-k', 'Other winners to expect at a record ' + moneyShort(rec) + ' jackpot');
    const shareRec = C.shareFactor(lamRec), shareAnti = C.shareFactor(antiNow);
    setText('#c-share', pct(shareRec));
    setText('#c-share-d', 'A crowd-avoiding ticket would keep about ' + pct(shareAnti) + '.');
    // flags
    const flags = C.patternFlags(g, whites, bonus, PAST[K.game]);
    const high = whites.filter(function (x) { return x > 31; }).length;
    if (high >= 3) flags.push({ level: 'good', text: high + ' of your white balls are above 31, where fewer people pick.' });
    const rb = P.rBonus(bonus);
    if (bonus !== 7) flags.push({ level: rb > 1.15 ? 'warn' : rb < 0.95 ? 'good' : 'info', text: g.bonusName + ' ' + bonus + ' is picked ' + times(rb) + ' as often as average by people who choose their own.' });
    if (!flags.some(function (f) { return f.level !== 'good'; })) flags.push({ level: 'good', text: 'No crowd patterns found.' });
    const ul = $('#c-flags');
    ul.textContent = '';
    flags.forEach(function (f) {
      const li = document.createElement('li'); li.className = f.level;
      const ic = document.createElement('span'); ic.className = 'ic'; ic.setAttribute('aria-hidden', 'true');
      ic.textContent = f.level === 'good' ? '✓' : f.level === 'info' ? 'i' : '!';
      const tx = document.createElement('span');
      tx.textContent = (f.level === 'bad' ? 'Crowded: ' : f.level === 'warn' ? 'Caution: ' : '') + f.text;
      li.appendChild(ic); li.appendChild(tx);
      ul.appendChild(li);
    });
  }

  /* =========================================================
     Evidence: the play slip heatmap
     ========================================================= */
  const EV = { game: 'pb' };
  function divergingColor(t) {
    // t in [-1, 1]: -1 = avoided (blue), 0 = average (neutral), 1 = crowded (red)
    const neg = [[0x0d, 0x36, 0x6b], [0x25, 0x6a, 0xbf], [0x6d, 0xa7, 0xec], [0xb7, 0xd3, 0xf6]];
    const pos = [[0xf8, 0xc9, 0xc4], [0xee, 0x8a, 0x80], [0xd6, 0x45, 0x3d], [0x8e, 0x1b, 0x17]];
    const mid = hexToRgb(cssVar('--neutral-mid') || '#f0efec');
    function lerp(a, b, u) { return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]; }
    function ramp(stops, u) { // u in [0,1] from mid outward
      const pts = [mid].concat(stops);
      const s = u * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(s));
      return lerp(pts[i], pts[i + 1], s - i);
    }
    const c = t < 0 ? ramp(neg.slice().reverse(), Math.min(1, -t)) : ramp(pos, Math.min(1, t));
    return 'rgb(' + c.map(function (v) { return Math.round(v); }).join(',') + ')';
  }
  function hexToRgb(h) { h = h.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
  function lum(rgbStr) {
    const m = rgbStr.match(/\d+/g).map(Number).map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2];
  }
  function initSlip() {
    $$('#e-game button').forEach(function (b) {
      b.addEventListener('click', function () {
        EV.game = b.dataset.game;
        $$('#e-game button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        renderSlip();
      });
    });
    renderSlip();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    if (mq.addEventListener) mq.addEventListener('change', function () { renderSlip(); renderValueChart(); renderFreq(); renderBday(); });
  }
  function renderSlip() {
    const id = EV.game, g = GAMES[id], ev = D.evidence[id];
    setText('#e-slip-title', g.name);
    setText('#e-slip-bonus', g.bonusName + ' (1–' + g.bonus + ')');
    const LIM = Math.log2(2);
    function paint(container, values, labelFn) {
      container.textContent = '';
      values.forEach(function (val, i) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.tabIndex = 0;
        const t = Math.max(-1, Math.min(1, Math.log2(val) / LIM));
        const bg = divergingColor(t);
        cell.style.background = bg;
        cell.style.color = lum(bg) < 0.33 ? '#fff' : '#17171b';
        cell.textContent = pad2(i + 1);
        const rows = [{ text: labelFn(i + 1, val) }];
        cell.setAttribute('aria-label', labelFn(i + 1, val));
        cell.addEventListener('pointermove', function (e) { showTip(e.clientX, e.clientY, rows); });
        cell.addEventListener('pointerleave', hideTip);
        cell.addEventListener('focus', function () { focusTip(cell, rows); });
        cell.addEventListener('blur', hideTip);
        container.appendChild(cell);
      });
    }
    paint($('#e-slip-white'), ev.white, function (n, v) { return n + ': on ' + times(v) + ' as many self-picked tickets as the average number'; });
    paint($('#e-slip-bonus-grid'), ev.bonus, function (n, v) { return g.bonusName + ' ' + n + ': picked ' + times(v) + ' as often as average'; });
    const scale = $('#e-scale-bar');
    const stops = [];
    for (let i = 0; i <= 10; i++) stops.push(divergingColor(-1 + i / 5) + ' ' + i * 10 + '%');
    scale.style.background = 'linear-gradient(90deg,' + stops.join(',') + ')';
    // table view
    const tb = $('#e-table');
    tb.textContent = '';
    const hr = document.createElement('tr');
    ['Number', 'White ball (× average)', g.bonusName + ' (× average)'].forEach(function (h) { const th = document.createElement('th'); th.textContent = h; hr.appendChild(th); });
    tb.appendChild(hr);
    ev.white.forEach(function (v, i) {
      const tr = document.createElement('tr');
      [String(i + 1), v.toFixed(2), i < ev.bonus.length ? ev.bonus[i].toFixed(2) : ''].forEach(function (x) { const td = document.createElement('td'); td.textContent = x; tr.appendChild(td); });
      tb.appendChild(tr);
    });
  }

  function fillTable(tb, headers, rows) {
    tb.textContent = '';
    const hr = document.createElement('tr');
    headers.forEach(function (h) { const th = document.createElement('th'); th.textContent = h; hr.appendChild(th); });
    tb.appendChild(hr);
    rows.forEach(function (r) {
      const tr = document.createElement('tr');
      r.forEach(function (x) { const td = document.createElement('td'); td.textContent = x; tr.appendChild(td); });
      tb.appendChild(tr);
    });
  }

  /* birthday effect columns */
  function renderBday() {
    const box = $('#e-bday');
    if (!box) return;
    const data = D.evidence.pb.byBirthday; // [{k, draws, ratio}]
    fillTable($('#e-bday-table'), ['Winning white balls 31 or lower', 'Draws', 'Match-3+ winners vs. random'],
      data.map(function (d) { return [d.k + ' of 5', String(d.draws), d.ratio.toFixed(2) + '×']; }));
    const W = Math.max(280, box.clientWidth), H = 220;
    const m = { l: 40, r: 10, t: 14, b: 40 };
    box.textContent = '';
    const svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, role: 'img', 'aria-label': 'Column chart: winners compared with a random crowd, by how many winning white balls were 31 or lower' }, box);
    const yMax = Math.max(1.6, Math.max.apply(null, data.map(function (d) { return d.ratio; })) * 1.1);
    const y = function (v) { return m.t + (1 - v / yMax) * (H - m.t - m.b); };
    niceTicks(0, yMax, 4).forEach(function (t) {
      svgEl('line', { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t), stroke: cssVar('--grid') }, svg);
      const tx = svgEl('text', { x: m.l - 6, y: y(t) + 4, 'text-anchor': 'end', fill: cssVar('--ink-3'), 'font-size': 11 }, svg);
      tx.textContent = t.toFixed(1) + '×';
    });
    svgEl('line', { x1: m.l, x2: W - m.r, y1: y(1), y2: y(1), stroke: cssVar('--ink'), 'stroke-width': 1.25 }, svg);
    const band = (W - m.l - m.r) / data.length;
    const bw = Math.min(24, band * 0.5);
    data.forEach(function (d, i) {
      const cx = m.l + band * (i + 0.5);
      const top = y(d.ratio), base = y(0);
      const h = Math.max(1, base - top);
      const r = Math.min(4, h);
      const path = 'M' + (cx - bw / 2) + ' ' + base + 'V' + (top + r) + 'Q' + (cx - bw / 2) + ' ' + top + ' ' + (cx - bw / 2 + r) + ' ' + top + 'H' + (cx + bw / 2 - r) + 'Q' + (cx + bw / 2) + ' ' + top + ' ' + (cx + bw / 2) + ' ' + (top + r) + 'V' + base + 'Z';
      const bar = svgEl('path', { d: path, fill: cssVar('--dropout'), tabindex: 0 }, svg);
      const lab = svgEl('text', { x: cx, y: top - 6, 'text-anchor': 'middle', fill: cssVar('--ink'), 'font-size': 11, 'font-weight': 700, stroke: cssVar('--slip'), 'stroke-width': 4, 'paint-order': 'stroke', 'stroke-linejoin': 'round' }, svg);
      lab.textContent = d.ratio.toFixed(2) + '×';
      const xl = svgEl('text', { x: cx, y: H - m.b + 16, 'text-anchor': 'middle', fill: cssVar('--ink-3'), 'font-size': 11 }, svg);
      xl.textContent = d.k + ' of 5';
      const rows = [{ text: d.k + ' of 5 winning white balls were 31 or lower' }, { text: d.draws + ' draws; match-3+ winners were ' + d.ratio.toFixed(2) + '× what random tickets would produce' }];
      bar.addEventListener('pointermove', function (e) { showTip(e.clientX, e.clientY, rows); });
      bar.addEventListener('pointerleave', hideTip);
      bar.addEventListener('focus', function () { focusTip(bar, rows); });
      bar.addEventListener('blur', hideTip);
    });
    const cap = svgEl('text', { x: m.l + (W - m.l - m.r) / 2, y: H - 6, 'text-anchor': 'middle', fill: cssVar('--ink-2'), 'font-size': 11 }, svg);
    cap.textContent = 'Winning white balls that were 31 or lower';
  }

  /* =========================================================
     Evidence: frequency of each white ball
     ========================================================= */
  function renderFreq() {
    const box = $('#r-freq');
    if (!box) return;
    const R = D.randomness.pb;
    const counts = R.white_counts, exp = R.expected, n = R.n_draws;
    const p = 5 / counts.length, sd = Math.sqrt(n * p * (1 - p));
    const tb = $('#r-table');
    if (tb && !tb.rows.length) fillTable(tb, ['Ball', 'Times drawn', 'vs. expected'], counts.map(function (c, i) { return [String(i + 1), String(c), ((c / exp - 1) * 100 >= 0 ? '+' : '') + ((c / exp - 1) * 100).toFixed(0) + '%']; }));
    const W = Math.max(300, box.clientWidth), H = 240;
    const m = { l: 36, r: 8, t: 12, b: 30 };
    box.textContent = '';
    const svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, role: 'img', 'aria-label': 'Column chart of how often each Powerball white ball was drawn since October 2015' }, box);
    const yMax = Math.ceil((Math.max.apply(null, counts) + 8) / 10) * 10;
    const y = function (v) { return m.t + (1 - v / yMax) * (H - m.t - m.b); };
    const band = (W - m.l - m.r) / counts.length;
    // expected band
    svgEl('rect', { x: m.l, width: W - m.l - m.r, y: y(exp + 2 * sd), height: y(exp - 2 * sd) - y(exp + 2 * sd), fill: cssVar('--s-qp'), opacity: 0.1 }, svg);
    niceTicks(0, yMax, 4).forEach(function (t) {
      svgEl('line', { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t), stroke: cssVar('--grid') }, svg);
      const tx = svgEl('text', { x: m.l - 6, y: y(t) + 4, 'text-anchor': 'end', fill: cssVar('--ink-3'), 'font-size': 11 }, svg);
      tx.textContent = t;
    });
    const maxI = counts.indexOf(Math.max.apply(null, counts)), minI = counts.indexOf(Math.min.apply(null, counts));
    counts.forEach(function (c, i) {
      const cx = m.l + band * (i + 0.5), bw = Math.max(1.5, Math.min(24, band - 2));
      const top = y(c), base = y(0);
      const isExt = i === maxI || i === minI;
      const rect = svgEl('rect', { x: cx - bw / 2, y: top, width: bw, height: base - top, fill: isExt ? cssVar('--dropout') : cssVar('--s-qp'), rx: Math.min(2, bw / 2) }, svg);
      const hit = svgEl('rect', { x: m.l + band * i, y: m.t, width: band, height: H - m.t - m.b, fill: 'transparent' }, svg);
      const rows = [{ text: 'Ball ' + (i + 1) + ': drawn ' + c + ' times' }, { text: 'Expected ' + exp.toFixed(0) + ' (' + (c >= exp ? '+' : '') + ((c / exp - 1) * 100).toFixed(0) + '%)' }];
      hit.addEventListener('pointermove', function (e) { rect.setAttribute('opacity', '0.75'); showTip(e.clientX, e.clientY, rows); });
      hit.addEventListener('pointerleave', function () { rect.setAttribute('opacity', '1'); hideTip(); });
      if (isExt) {
        const lab = svgEl('text', { x: cx, y: top - 5, 'text-anchor': 'middle', fill: cssVar('--ink'), 'font-size': 11, 'font-weight': 700, stroke: cssVar('--slip'), 'stroke-width': 4, 'paint-order': 'stroke', 'stroke-linejoin': 'round' }, svg);
        lab.textContent = (i + 1) + ': ' + c;
      }
    });
    svgEl('line', { x1: m.l, x2: W - m.r, y1: y(exp), y2: y(exp), stroke: cssVar('--ink'), 'stroke-width': 1.25 }, svg);
    [1, 10, 20, 30, 40, 50, 60, 69].forEach(function (nn) {
      const tx = svgEl('text', { x: m.l + band * (nn - 0.5), y: H - m.b + 16, 'text-anchor': 'middle', fill: cssVar('--ink-3'), 'font-size': 11 }, svg);
      tx.textContent = nn;
    });
  }


  /* =========================================================
     Winners: filter the story groups (all groups visible by default)
     ========================================================= */
  function initWinnerFilter() {
    const bar = $('#w-filter');
    if (!bar) return;
    $$('button', bar).forEach(function (b) {
      b.addEventListener('click', function () {
        const f = b.dataset.filter;
        $$('button', bar).forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        $$('.story-group').forEach(function (g) { g.hidden = f !== 'all' && g.dataset.group !== f; });
      });
    });
    const ex = $('#w-expand');
    if (ex) ex.addEventListener('click', function () {
      const open = ex.getAttribute('aria-pressed') !== 'true';
      ex.setAttribute('aria-pressed', String(open));
      ex.textContent = open ? 'Close all stories' : 'Open all stories';
      $$('.story-more').forEach(function (d) { d.open = open; });
    });
  }

  /* =========================================================
     Nav highlight
     ========================================================= */
  function initNav() {
    const links = $$('.topnav a');
    if (links[0] && window.scrollY < 200) links[0].setAttribute('aria-current', 'true');
    if (!('IntersectionObserver' in window)) return;
    const map = {};
    links.forEach(function (a) { map[a.getAttribute('href').slice(1)] = a; });
    const io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          links.forEach(function (a) { a.removeAttribute('aria-current'); });
          const a = map[e.target.id];
          if (a) a.setAttribute('aria-current', 'true');
        }
      });
    }, { rootMargin: '-40% 0px -55% 0px' });
    Object.keys(map).forEach(function (id) { const s = document.getElementById(id); if (s) io.observe(s); });
  }

  initHero();
  initValue();
  initSpread();
  initCheck();
  initSlip();
  renderBday();
  renderFreq();
  onResize($('#e-bday'), renderBday);
  onResize($('#r-freq'), renderFreq);
  initWinnerFilter();
  initNav();
})();
