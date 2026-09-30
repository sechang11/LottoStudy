/* Lottery Edge Lab: pure math, no DOM.
   Runs in the browser (window.LottoCore) and in Node (module.exports) so it can be tested. */
(function (root) {
  'use strict';

  /* ---------- basics ---------- */

  function comb(n, k) {
    if (k < 0 || k > n) return 0;
    k = Math.min(k, n - k);
    let r = 1;
    for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
    return Math.round(r);
  }

  // Small, fast, seedable PRNG so a generated set of tickets can be reproduced.
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Expected share of a jackpot when the number of OTHER winners is Poisson(lambda).
  // E[1 / (1 + K)] = (1 - e^-lambda) / lambda
  function shareFactor(lambda) {
    if (lambda < 1e-9) return 1 - lambda / 2;
    return -Math.expm1(-lambda) / lambda;
  }

  /* ---------- games ---------- */

  // tiers: k = white balls matched, m = bonus ball matched (1/0), base = base prize in dollars
  function makeGame(def) {
    const g = Object.assign({}, def);
    g.whiteCombos = comb(g.whites, 5);
    g.combos = g.whiteCombos * g.bonus;
    g.tiers = def.tiers.map(function (t) {
      const pw = (comb(5, t.k) * comb(g.whites - 5, 5 - t.k)) / g.whiteCombos;
      const p = pw * (t.m ? 1 / g.bonus : (g.bonus - 1) / g.bonus);
      return Object.assign({}, t, { p: p, odds: 1 / p });
    });
    g.pAnyPrize = g.tiers.reduce(function (s, t) { return s + t.p; }, 0);
    return g;
  }

  /* ---------- taxes ---------- */

  // Generous-to-the-ticket tax model:
  //   prizes of $1M or more: top federal bracket + state (+ local)
  //   prizes over $5,000: 24% federal (the mandatory withholding rate) + state (+ local)
  //   smaller prizes: left untaxed (they are legally taxable, we just don't charge the ticket for it)
  function taxRate(prize, tax) {
    if (prize >= 1e6) return tax.fedTop + tax.state + (tax.local || 0);
    if (prize > 5000) return tax.fedMid + tax.state + (tax.local || 0);
    return 0;
  }

  // Expected value of all non-jackpot prizes for one base play.
  // mult: [[multiplier, weight], ...] for a built-in multiplier (Mega Millions), or null.
  function lowerTierEV(g, tax, mult) {
    const dist = normDist(mult || [[1, 1]]);
    let pre = 0, post = 0;
    const byTier = [];
    g.tiers.forEach(function (t) {
      if (t.jackpot) return;
      let e = 0, ea = 0;
      dist.forEach(function (d) {
        const prize = t.base * d[0];
        e += d[1] * prize;
        ea += d[1] * prize * (1 - (tax ? taxRate(prize, tax) : 0));
      });
      pre += t.p * e;
      post += t.p * ea;
      byTier.push({ k: t.k, m: t.m, p: t.p, prize: e, ev: t.p * e, evAfterTax: t.p * ea });
    });
    return { pre: pre, post: post, byTier: byTier };
  }

  function normDist(d) {
    const tot = d.reduce(function (s, x) { return s + x[1]; }, 0);
    return d.map(function (x) { return [x[0], x[1] / tot]; });
  }

  // Power Play (Powerball add-on): value of the extra $1, pre-tax and after tax.
  // The 10x ball is only in the drum when the advertised jackpot is at or below tenXCap.
  function addonEV(g, annuity, tax) {
    const a = g.addon;
    if (!a) return null;
    const dist = normDist(a.dist.filter(function (d) { return d[0] !== 10 || annuity <= a.tenXCap; }));
    let pre = 0, post = 0;
    g.tiers.forEach(function (t) {
      if (t.jackpot) return;
      if (t.k === 5) {
        const extra = a.match5 - t.base;
        pre += t.p * extra;
        post += t.p * (a.match5 * (1 - taxRate(a.match5, tax)) - t.base * (1 - taxRate(t.base, tax)));
        return;
      }
      dist.forEach(function (d) {
        const prize = t.base * d[0];
        pre += t.p * d[1] * (prize - t.base);
        post += t.p * d[1] * (prize * (1 - taxRate(prize, tax)) - t.base * (1 - taxRate(t.base, tax)));
      });
    });
    return { price: a.price, pre: pre, post: post };
  }

  /* ---------- how many tickets get sold ---------- */

  // Piecewise-linear in log-log space through the median plays of each jackpot band (g.sales.knots:
  // [[ln annuity, ln plays], ...]). Past the last knot it continues at the last band's slope.
  function playsFor(g, annuity) {
    const k = g.sales.knots;
    const x = Math.log(annuity);
    if (x <= k[0][0]) return Math.exp(k[0][1]);
    for (let i = 1; i < k.length; i++) {
      if (x <= k[i][0]) {
        const u = (x - k[i - 1][0]) / (k[i][0] - k[i - 1][0]);
        return Math.exp(k[i - 1][1] + u * (k[i][1] - k[i - 1][1]));
      }
    }
    const a = k[k.length - 2], b = k[k.length - 1];
    const slope = Math.min(g.sales.maxSlope || 4, (b[1] - a[1]) / (b[0] - a[0]));
    return Math.exp(b[1] + slope * (x - b[0]));
  }

  /* ---------- who picks what ---------- */

  // Product-form model fitted to national prize-tier winner counts:
  //   a self-picked ticket's five white balls S have probability proportional to prod(w[n] for n in S),
  //   its bonus ball b has probability proportional to v[b]; a fraction qp of tickets are quick picks (uniform).
  function makePopularity(g, pop) {
    const W = g.whites, B = g.bonus;
    const w = Float64Array.from(pop.w), v = Float64Array.from(pop.v);
    // suffix elementary symmetric polynomials: suf[i*6 + k] = e_k(w[i..W-1])
    const suf = new Float64Array((W + 1) * 6);
    suf[W * 6] = 1;
    for (let i = W - 1; i >= 0; i--) {
      suf[i * 6] = 1;
      for (let k = 1; k <= 5; k++) suf[i * 6 + k] = suf[(i + 1) * 6 + k] + w[i] * suf[(i + 1) * 6 + k - 1];
    }
    const e5 = suf[5];
    const vSum = v.reduce(function (s, x) { return s + x; }, 0);
    const P = {
      qp: pop.qp, w: w, v: v,
      // popularity ratio of the white set vs a uniformly random set (1 = average)
      rWhite: function (whites) {
        let p = 1;
        for (let i = 0; i < whites.length; i++) p *= w[whites[i] - 1];
        return (g.whiteCombos * p) / e5;
      },
      rBonus: function (b) { return (B * v[b - 1]) / vSum; },
      // popularity ratio of a full ticket among self-pickers (1 = a uniformly random ticket)
      R: function (whites, b) { return P.rWhite(whites) * P.rBonus(b); },
      // mean number of copies of this exact ticket per "uniform-average" ticket, mixing quick picks in
      crowd: function (whites, b) { return pop.qp + (1 - pop.qp) * P.R(whites, b); },
      sampleSelfPick: function (rng) {
        const out = [];
        let k = 5;
        for (let i = 0; i < W && k > 0; i++) {
          const pr = (w[i] * suf[(i + 1) * 6 + k - 1]) / suf[i * 6 + k];
          if (rng() < pr) { out.push(i + 1); k--; }
        }
        let r = rng() * vSum, b = 1;
        for (let j = 0; j < B; j++) { r -= v[j]; if (r <= 0) { b = j + 1; break; } }
        return { whites: out, bonus: b };
      },
      sampleUniform: function (rng) { return { whites: sampleWhites(W, rng), bonus: 1 + Math.floor(rng() * B) }; }
    };
    return P;
  }

  function sampleWhites(W, rng) {
    const pool = [];
    for (let i = 1; i <= W; i++) pool.push(i);
    for (let i = 0; i < 5; i++) {
      const j = i + Math.floor(rng() * (W - i));
      const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    return pool.slice(0, 5).sort(function (a, b) { return a - b; });
  }

  // Crowd factors (qp + (1-qp) R) for many random tickets, used to average the jackpot share.
  function crowdSample(P, how, n, seed) {
    const rng = mulberry32(seed || 7);
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const t = how === 'self' ? P.sampleSelfPick(rng) : P.sampleUniform(rng);
      out[i] = P.crowd(t.whites, t.bonus);
    }
    return out;
  }

  // Expected jackpot share for a ticket-picking strategy, given the average number of copies
  // per combination (lambdaBar = plays / combos). crowd is a single factor or a sample of factors.
  function expectedShare(lambdaBar, crowd) {
    if (typeof crowd === 'number') return shareFactor(lambdaBar * crowd);
    let s = 0;
    for (let i = 0; i < crowd.length; i++) s += shareFactor(lambdaBar * crowd[i]);
    return s / crowd.length;
  }

  /* ---------- expected value of one ticket ---------- */

  // o: { annuity, cashRatio, tax:{fedTop, fedMid, state, local}, plays?, crowd (number or sample) }
  function ticketEV(g, o) {
    const plays = o.plays || playsFor(g, o.annuity);
    const cash = o.annuity * o.cashRatio;
    const jpRate = o.tax.fedTop + o.tax.state + (o.tax.local || 0);
    const cashAfterTax = cash * (1 - jpRate);
    const lambdaBar = plays / g.combos;
    const share = expectedShare(lambdaBar, o.crowd);
    const pJ = 1 / g.combos;
    const lower = lowerTierEV(g, o.tax, g.multiplier);
    const lowerPre = lowerTierEV(g, null, g.multiplier);
    const jpEV = pJ * cashAfterTax * share;
    return {
      price: g.price, plays: plays, lambdaBar: lambdaBar, share: share,
      pNobodyElse: Math.exp(-lambdaBar), // rough: chance a random combo has no other holder
      cash: cash, cashAfterTax: cashAfterTax, expectedPrizeIfWin: cashAfterTax * share,
      jpEV: jpEV, lowerEV: lower.post, lowerPre: lowerPre.pre,
      advertisedEV: pJ * o.annuity + lowerPre.pre, // what naive "jackpot x odds" math says
      total: jpEV + lower.post, ret: (jpEV + lower.post) / g.price
    };
  }

  // Smallest bankroll at which ONE ticket raises expected log-wealth (the Kelly criterion's test).
  // outcomes: [{p, payoff}] excluding the losing outcome. Returns Infinity when EV <= price.
  function kellyMinBankroll(outcomes, price) {
    const ev = outcomes.reduce(function (s, x) { return s + x.p * x.payoff; }, 0);
    if (ev <= price) return Infinity;
    const pLose = 1 - outcomes.reduce(function (s, x) { return s + x.p; }, 0);
    function gain(W) {
      let s = pLose * Math.log1p(-price / W);
      outcomes.forEach(function (x) { s += x.p * Math.log1p((x.payoff - price) / W); });
      return s;
    }
    let lo = Math.log(price * 1.0001), hi = Math.log(1e16);
    if (gain(Math.exp(hi)) <= 0) return Infinity;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (gain(Math.exp(mid)) > 0) hi = mid; else lo = mid;
    }
    return Math.exp(hi);
  }

  /* ---------- patterns people love ---------- */

  const FAMOUS = [
    { set: [4, 8, 15, 16, 23], note: 'the "Lost" numbers (4 8 15 16 23 42), played by thousands every draw' },
    { set: [1, 2, 3, 4, 5], note: '1-2-3-4-5, the most common "pattern" ticket' },
    { set: [7, 14, 21, 28, 35], note: 'multiples of 7' },
    { set: [10, 20, 30, 40, 50], note: 'multiples of 10' },
    { set: [5, 10, 15, 20, 25], note: 'multiples of 5' }
  ];

  // pastIndex: Map from "a-b-c-d-e" to draw date. Returns a list of {level, text} flags.
  function patternFlags(g, whites, bonus, pastIndex) {
    const s = whites.slice().sort(function (a, b) { return a - b; });
    const flags = [];
    const key = s.join('-');
    let famous = false;
    FAMOUS.forEach(function (f) {
      if (f.set.join('-') === key) { famous = true; flags.push({ level: 'bad', text: 'This is ' + f.note + '.' }); }
    });
    if (pastIndex && pastIndex.has(key)) flags.push({ level: 'bad', text: 'These five white balls already won on ' + pastIndex.get(key) + '. People replay past winners.' });
    let run = 1, best = 1;
    for (let i = 1; i < 5; i++) { run = s[i] === s[i - 1] + 1 ? run + 1 : 1; best = Math.max(best, run); }
    const d = s[1] - s[0];
    const arith = s.every(function (x, i) { return i === 0 || x - s[i - 1] === d; });
    if (arith && !famous) flags.push({ level: 'bad', text: 'An evenly spaced sequence (step ' + d + '). Pattern tickets are shared by crowds.' });
    else if (best >= 3) flags.push({ level: 'warn', text: 'A run of ' + best + ' consecutive numbers. Long runs are a favorite pattern.' });
    if (s.every(function (x) { return x % 10 === s[0] % 10; })) flags.push({ level: 'bad', text: 'Every number ends in ' + (s[0] % 10) + '.' });
    [5, 7, 9, 11].forEach(function (m) {
      if (!arith && !famous && s.every(function (x) { return x % m === 0; })) flags.push({ level: 'bad', text: 'All multiples of ' + m + '.' });
    });
    const bday = s.filter(function (x) { return x <= 31; }).length;
    if (bday === 5) flags.push({ level: 'warn', text: 'All five numbers are 31 or lower, so they could all be birthdays. That is the single most crowded region.' });
    else if (bday >= 4) flags.push({ level: 'warn', text: bday + ' of 5 numbers are 31 or lower (birthday range).' });
    if (s.every(function (x) { return x <= 12; })) flags.push({ level: 'warn', text: 'All numbers are 12 or lower (months).' });
    if (bonus === 7) flags.push({ level: 'warn', text: 'The ' + g.bonusName + ' is 7, the most popular pick.' });
    return flags;
  }

  /* ---------- spreading several tickets ---------- */

  // mode: 'smart' (spread + avoid the crowd), 'spread' (spread only), 'random' (quick picks)
  // tilt: preference for unpopular numbers when sampling candidates; usageDiv/usageW: how hard to push
  // toward numbers not used yet (low, because the shared-pair penalty already keeps tickets apart);
  // popW: weight of the popularity ratio in the score. Tuned so 50 tickets still share no pair.
  const SMART = { tilt: 4, usageDiv: 0.3, usageW: 0.5, popW: 10 };
  function generateTickets(g, n, mode, P, seed, pastIndex, tune) {
    const T = Object.assign({}, SMART, tune || {});
    const rng = mulberry32(seed);
    const W = g.whites, B = g.bonus;
    const usage = new Float64Array(W + 1);
    const pairUsed = new Uint8Array((W + 1) * (W + 1));
    const seen = new Set();
    const tickets = [];

    // bonus balls: every ticket gets a different one until all are used
    let bonusOrder = [];
    for (let b = 1; b <= B; b++) bonusOrder.push(b);
    if (mode === 'smart') bonusOrder.sort(function (a, b) { return P.v[a - 1] - P.v[b - 1]; });
    else shuffle(bonusOrder, rng);

    // sampling tilt toward numbers the crowd avoids
    const tilt = new Float64Array(W + 1);
    for (let i = 1; i <= W; i++) tilt[i] = mode === 'smart' ? Math.pow(1 / P.w[i - 1], T.tilt) : 1;
    const usageDiv = mode === 'smart' ? T.usageDiv : 2, usageW = mode === 'smart' ? T.usageW : 8;

    for (let t = 0; t < n; t++) {
      let best = null, bestScore = Infinity;
      const trials = mode === 'random' ? 1 : 400;
      for (let trial = 0; trial < trials; trial++) {
        let S;
        if (mode === 'random') S = sampleWhites(W, rng);
        else {
          const wts = new Float64Array(W + 1);
          for (let i = 1; i <= W; i++) wts[i] = tilt[i] / Math.pow(1 + usage[i], usageDiv);
          S = weightedSample5(wts, W, rng);
        }
        const key = S.join('-');
        if (seen.has(key)) continue;
        let score = 0;
        if (mode !== 'random') {
          let rep = 0;
          for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) rep += pairUsed[S[i] * (W + 1) + S[j]];
          score += rep * 1000;
          for (let i = 0; i < 5; i++) score += usage[S[i]] * usageW;
          if (mode === 'smart') {
            score += Math.log(P.rWhite(S)) * T.popW; // lower popularity ratio = better
            const flags = patternFlags(g, S, 0, pastIndex);
            score += flags.length * 500;
          }
        }
        if (score < bestScore) { bestScore = score; best = S; }
      }
      if (!best) { t--; continue; }
      seen.add(best.join('-'));
      for (let i = 0; i < 5; i++) {
        usage[best[i]]++;
        for (let j = i + 1; j < 5; j++) pairUsed[best[i] * (W + 1) + best[j]] = 1;
      }
      const bonus = mode === 'random' ? 1 + Math.floor(rng() * B) : bonusOrder[t % B];
      tickets.push({ whites: best, bonus: bonus });
    }
    return tickets;
  }

  function shuffle(a, rng) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function weightedSample5(wts, W, rng) {
    const taken = new Uint8Array(W + 1);
    const out = [];
    let total = 0;
    for (let i = 1; i <= W; i++) total += wts[i];
    while (out.length < 5) {
      let r = rng() * total, pick = W;
      for (let i = 1; i <= W; i++) {
        if (taken[i]) continue;
        r -= wts[i];
        if (r <= 0) { pick = i; break; }
      }
      if (taken[pick]) { for (let i = W; i >= 1; i--) if (!taken[i]) { pick = i; break; } }
      taken[pick] = 1;
      total -= wts[pick];
      out.push(pick);
    }
    return out.sort(function (a, b) { return a - b; });
  }

  // Summary numbers for a set of tickets. Simulates draws for the "win anything" odds.
  function ticketSetStats(g, tickets, P, samples, seed) {
    const n = tickets.length;
    const W = g.whites, B = g.bonus;
    const bonuses = new Set(tickets.map(function (t) { return t.bonus; }));
    // exact: pairwise overlap
    let maxOverlap = 0, sharedPairs = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      let o = 0;
      for (const x of tickets[i].whites) if (tickets[j].whites.indexOf(x) >= 0) o++;
      maxOverlap = Math.max(maxOverlap, o);
      if (o >= 2) sharedPairs++;
    }
    const numbersUsed = new Set();
    tickets.forEach(function (t) { t.whites.forEach(function (x) { numbersUsed.add(x); }); });
    // simulate: prize outcome of every ticket for random draws
    const rng = mulberry32(seed || 99);
    const mark = new Uint8Array(W + 1);
    const prizeOf = {};
    g.tiers.forEach(function (t) { if (!t.jackpot) prizeOf[t.k * 2 + t.m] = t.base; });
    const mdist = g.multiplier ? normDist(g.multiplier) : null;
    function mult() {
      if (!mdist) return 1;
      let r = rng();
      for (let i = 0; i < mdist.length; i++) { r -= mdist[i][1]; if (r <= 0) return mdist[i][0]; }
      return mdist[mdist.length - 1][0];
    }
    let anyWin = 0, ge3 = 0, backCost = 0;
    const pool = new Int32Array(W);
    for (let s = 0; s < samples; s++) {
      for (let i = 0; i < W; i++) pool[i] = i + 1;
      for (let i = 0; i < 5; i++) {
        const j = i + Math.floor(rng() * (W - i));
        const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
        mark[pool[i]] = 1;
      }
      const b = 1 + Math.floor(rng() * B);
      let won = 0, any = false, three = false;
      for (let t = 0; t < n; t++) {
        const tk = tickets[t];
        let k = 0;
        for (let i = 0; i < 5; i++) k += mark[tk.whites[i]];
        const m = tk.bonus === b ? 1 : 0;
        if (k >= 3) three = true;
        const pz = k === 5 && m === 1 ? 1e8 : prizeOf[k * 2 + m];
        if (pz) { any = true; won += pz * mult(); }
      }
      for (let i = 0; i < 5; i++) mark[pool[i]] = 0;
      if (any) anyWin++;
      if (three) ge3++;
      if (won >= n * g.price) backCost++;
    }
    let crowdSum = 0, rSum = 0;
    tickets.forEach(function (t) { crowdSum += P.crowd(t.whites, t.bonus); rSum += P.R(t.whites, t.bonus); });
    // Any prize = the bonus ball matches one of our bonus numbers (exact), or else some ticket
    // matches 3+ white balls (simulated; white and bonus draws are independent).
    const uB = bonuses.size / B;
    return {
      n: n, pJackpot: n / g.combos, bonusesCovered: bonuses.size,
      maxOverlap: maxOverlap, sharedPairs: sharedPairs, numbersUsed: numbersUsed.size,
      pAny: uB + (1 - uB) * (ge3 / samples), pAnySim: anyWin / samples, pGe3: ge3 / samples, pBackCost: backCost / samples,
      meanCrowd: crowdSum / n, meanR: rSum / n
    };
  }

  const api = {
    comb: comb, mulberry32: mulberry32, shareFactor: shareFactor, makeGame: makeGame, taxRate: taxRate,
    lowerTierEV: lowerTierEV, addonEV: addonEV, playsFor: playsFor, makePopularity: makePopularity,
    crowdSample: crowdSample, expectedShare: expectedShare, ticketEV: ticketEV, kellyMinBankroll: kellyMinBankroll,
    patternFlags: patternFlags, generateTickets: generateTickets, ticketSetStats: ticketSetStats, sampleWhites: sampleWhites
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LottoCore = api;
})(typeof window !== 'undefined' ? window : this);
