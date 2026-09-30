// Sanity checks for src/core.js against data/site-data.json:  node tools/check-core.js
const C = require('../src/core.js');
const D = require('../data/site-data.json');
const assert = (c, m) => { if (!c) { console.error('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
const G = {}, P = {};
D.games.forEach(def => { G[def.id] = C.makeGame(def); P[def.id] = C.makePopularity(G[def.id], D.popularity[def.id]); });
const pb = G.pb, mm = G.mm;
assert(pb.combos === 292201338, 'Powerball combos 292,201,338');
assert(mm.combos === 290472336, 'Mega Millions combos 290,472,336');
assert(Math.abs(1 / pb.pAnyPrize - 24.87) < 0.01, 'Powerball overall odds 1 in 24.87 (' + (1 / pb.pAnyPrize).toFixed(3) + ')');
assert(Math.abs(1 / mm.pAnyPrize - 23.07) < 0.02, 'Mega Millions overall odds 1 in 23.07 (' + (1 / mm.pAnyPrize).toFixed(3) + ')');
const lpb = C.lowerTierEV(pb, null, null), lmm = C.lowerTierEV(mm, null, mm.multiplier);
console.log('     PB lower tiers pre-tax per $2:', lpb.pre.toFixed(4), ' MM per $5:', lmm.pre.toFixed(4));
// popularity sanity: R averages to 1 over uniform tickets
const rng = C.mulberry32(1); let s = 0, n = 200000;
for (let i = 0; i < n; i++) { const t = P.pb.sampleUniform(rng); s += P.pb.R(t.whites, t.bonus); }
assert(Math.abs(s / n - 1) < 0.03, 'mean R over uniform tickets ~ 1 (' + (s / n).toFixed(3) + ')');
// self-pick sampler reproduces inclusion ratios
const cnt = new Float64Array(70); const r2 = C.mulberry32(2); const m = 100000;
for (let i = 0; i < m; i++) P.pb.sampleSelfPick(r2).whites.forEach(x => cnt[x]++);
const inc7 = cnt[7] / m / (5 / 69), inc61 = cnt[61] / m / (5 / 69);
assert(Math.abs(inc7 - D.evidence.pb.white[6]) < 0.05, 'self-pick sampler: 7 inclusion ' + inc7.toFixed(3) + ' vs ' + D.evidence.pb.white[6]);
assert(Math.abs(inc61 - D.evidence.pb.white[60]) < 0.05, 'self-pick sampler: 61 inclusion ' + inc61.toFixed(3) + ' vs ' + D.evidence.pb.white[60]);
// sales
[20e6, 100e6, 409e6, 1e9, 2.04e9].forEach(a => console.log('     PB plays @', a / 1e6, 'M =', (C.playsFor(pb, a) / 1e6).toFixed(1), 'M'));
[50e6, 321e6, 980e6, 1.602e9].forEach(a => console.log('     MM plays @', a / 1e6, 'M =', (C.playsFor(mm, a) / 1e6).toFixed(1), 'M'));
// EV
const qp = C.crowdSample(P.pb, 'uniform', 3000, 11), self = C.crowdSample(P.pb, 'self', 3000, 12);
const smart = C.generateTickets(pb, 30, 'smart', P.pb, 2026, null); let anti = 0; smart.forEach(t => anti += P.pb.crowd(t.whites, t.bonus)); anti /= smart.length;
console.log('     crowd factor: qp mean', (qp.reduce((a, b) => a + b) / qp.length).toFixed(3), ' self mean', (self.reduce((a, b) => a + b) / self.length).toFixed(3), ' anti', anti.toFixed(3));
const tax0 = { fedTop: 0.37, fedMid: 0.24, state: 0 };
for (const a of [20e6, 409e6, 1e9, 2.04e9]) {
  const row = ['qp', 'self', 'anti'].map(k => C.ticketEV(pb, { annuity: a, cashRatio: 0.416, tax: tax0, crowd: k === 'qp' ? qp : k === 'self' ? self : anti }));
  console.log('     PB EV @', (a / 1e6) + 'M', row.map(r => r.total.toFixed(3)).join(' / '), ' share', row.map(r => r.share.toFixed(3)).join('/'), ' plays', (row[0].plays / 1e6).toFixed(0) + 'M');
}
const mmqp = C.crowdSample(P.mm, 'uniform', 3000, 11);
for (const a of [50e6, 321e6, 980e6, 1.602e9]) {
  const r = C.ticketEV(mm, { annuity: a, cashRatio: 0.408, tax: tax0, crowd: mmqp });
  console.log('     MM EV @', (a / 1e6) + 'M', r.total.toFixed(3), 'of $5  lower', r.lowerEV.toFixed(3), 'share', r.share.toFixed(3));
}
// Kelly: best case record, no tax, no split
const rec = pb.records[0]; const outc = [{ p: 1 / pb.combos, payoff: rec.cash }]; C.lowerTierEV(pb, null, null).byTier.forEach(t => outc.push({ p: t.p, payoff: t.prize }));
console.log('     Kelly min bankroll PB best case: $' + (C.kellyMinBankroll(outc, 2) / 1e9).toFixed(2) + 'B, EV', outc.reduce((s, o) => s + o.p * o.payoff, 0).toFixed(3));
// Power play
const ad = C.addonEV(pb, 409e6, tax0); console.log('     Power Play value per $1: pre', ad.pre.toFixed(3), 'post', ad.post.toFixed(3));
const ad2 = C.addonEV(pb, 100e6, tax0); console.log('     Power Play value per $1 at $100M (10x in play): pre', ad2.pre.toFixed(3));
// spread stats
for (const mode of ['smart', 'spread', 'random']) {
  const t = C.generateTickets(pb, 10, mode, P.pb, 7, null); const st = C.ticketSetStats(pb, t, P.pb, 60000, 3);
  console.log('     10 tickets', mode.padEnd(6), 'pAny', st.pAny.toFixed(3), 'pGe3', st.pGe3.toFixed(4), 'maxOverlap', st.maxOverlap, 'bonuses', st.bonusesCovered, 'crowd', st.meanCrowd.toFixed(2));
}
const t50 = C.generateTickets(pb, 50, 'smart', P.pb, 7, null); const st50 = C.ticketSetStats(pb, t50, P.pb, 20000, 3);
console.log('     50 smart: maxOverlap', st50.maxOverlap, 'sharedPairs', st50.sharedPairs, 'numbers used', st50.numbersUsed, 'crowd', st50.meanCrowd.toFixed(2));
console.log('     sample smart tickets:', smart.slice(0, 5).map(t => t.whites.join(' ') + ' +' + t.bonus).join(' | '));
