// Prints the figures quoted in the page copy:  node tools/lever-numbers.js
const C = require('../src/core.js');
const D = require('../data/site-data.json');
const G = {}, P = {}, CR = {};
D.games.forEach(def => {
  const g = C.makeGame(def); G[g.id] = g; const p = C.makePopularity(g, D.popularity[g.id]); P[g.id] = p;
  const smart = C.generateTickets(g, 30, 'smart', p, 2026, null); let anti = 0; smart.forEach(t => anti += p.crowd(t.whites, t.bonus));
  CR[g.id] = { qp: C.crowdSample(p, 'uniform', 3000, 11), self: C.crowdSample(p, 'self', 3000, 12), anti: anti / smart.length };
});
const tax0 = { fedTop: 0.37, fedMid: 0.24, state: 0 };
for (const id of ['pb', 'mm']) {
  const g = G[id], cr = CR[id];
  const rec = g.records[0], cur = g.current;
  const ratio = cur.cash / cur.annuity;
  console.log(id.toUpperCase(), 'anti crowd factor', cr.anti.toFixed(3), ' self mean', (cr.self.reduce((a, b) => a + b) / cr.self.length).toFixed(3));
  for (const a of [cur.annuity, 1e9, rec.annuity]) {
    const r = {}; for (const k of ['qp', 'self', 'anti']) r[k] = C.ticketEV(g, { annuity: a, cashRatio: ratio, tax: tax0, crowd: cr[k] });
    console.log('  @', (a / 1e6).toFixed(0) + 'M plays', (r.qp.plays / 1e6).toFixed(0) + 'M',
      ' EV qp/self/anti', r.qp.total.toFixed(3), r.self.total.toFixed(3), r.anti.total.toFixed(3),
      ' share', r.qp.share.toFixed(3), r.self.share.toFixed(3), r.anti.share.toFixed(3),
      ' jp gain anti vs qp', ((r.anti.jpEV / r.qp.jpEV - 1) * 100).toFixed(1) + '%', 'vs self', ((r.anti.jpEV / r.self.jpEV - 1) * 100).toFixed(1) + '%');
  }
  // real record sales
  const real = id === 'pb' ? 275.9e6 : 171.7e6;
  const r2 = {}; for (const k of ['qp', 'self', 'anti']) r2[k] = C.ticketEV(g, { annuity: rec.annuity, cashRatio: rec.cash / rec.annuity, tax: tax0, crowd: cr[k], plays: real });
  console.log('  record with real sales', real / 1e6 + 'M: EV', r2.qp.total.toFixed(3), r2.self.total.toFixed(3), r2.anti.total.toFixed(3), 'share', r2.qp.share.toFixed(3), r2.self.share.toFixed(3), r2.anti.share.toFixed(3), 'gain vs qp', ((r2.anti.jpEV / r2.qp.jpEV - 1) * 100).toFixed(1) + '%');
  // max EV over jackpot for no-tax state, qp, using current cash ratio
  let best = { ev: 0 }; for (let i = 0; i < 400; i++) { const a = Math.exp(Math.log(20e6) + (Math.log(2.5e9) - Math.log(20e6)) * i / 399); const e = C.ticketEV(g, { annuity: a, cashRatio: ratio, tax: tax0, crowd: cr.qp }).total; if (e > best.ev) best = { ev: e, a }; }
  console.log('  best EV (no state tax, qp)', best.ev.toFixed(3), 'at', (best.a / 1e6).toFixed(0) + 'M');
  const outc = [{ p: 1 / g.combos, payoff: rec.cash }]; C.lowerTierEV(g, null, g.multiplier).byTier.forEach(t => outc.push({ p: t.p, payoff: t.prize }));
  console.log('  Kelly best case bankroll $' + (C.kellyMinBankroll(outc, g.price) / 1e6).toFixed(0) + 'M, EV', outc.reduce((s, o) => s + o.p * o.payoff, 0).toFixed(3));
  for (const n of [1, 5, 10, 26]) {
    const s = {}; for (const m of ['smart', 'spread', 'random']) s[m] = C.ticketSetStats(g, C.generateTickets(g, n, m, P[id], 20260930 + (m === 'random' ? 7 : 0), null), P[id], 100000, 31);
    console.log('  n=' + n, 'pAny smart/spread/random', s.smart.pAny.toFixed(3), s.spread.pAny.toFixed(3), s.random.pAny.toFixed(3), ' crowd', s.smart.meanCrowd.toFixed(2), s.random.meanCrowd.toFixed(2));
  }
}
