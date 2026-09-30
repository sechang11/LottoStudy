"""Estimate which numbers lottery players pick, from published prize-tier winner counts.

Model (product form):
  * a fraction qp of tickets are quick picks: uniform over all combinations;
  * the rest are self-picked: the five white balls S are chosen with probability proportional to
    prod(w[n] for n in S), and the bonus ball b with probability proportional to v[b].

For a draw with white set D and bonus ball b*, the chance that a self-picked ticket matches exactly
k white balls is e_k(w_D) * e_(5-k)(w_rest) / e_5(w), where e_j are elementary symmetric polynomials.
Every published tier count n[d, t] is Poisson with mean N_d * P_d(t); N_d (tickets in play for the
draw) is profiled out, so each draw only contributes the relative sizes of its nine tier counts.
"""
import json
import math

import numpy as np
import torch

torch.set_default_dtype(torch.float64)

# (white balls matched, bonus ball matched), in the order the counts are stored
TIERS = [(5, 1), (5, 0), (4, 1), (4, 0), (3, 1), (3, 0), (2, 1), (1, 1), (0, 1)]


def load_pb_rows(draws_path, tiers_path):
    nums = {}
    for x in json.load(open(draws_path)):
        n = [int(v) for v in x["winning_numbers"].split()]
        nums[x["draw_date"][:10]] = (sorted(n[:5]), n[5])
    key = {"m5-pb": (5, 1), "m5": (5, 0), "m4-pb": (4, 1), "m4": (4, 0), "m3-pb": (3, 1),
           "m3": (3, 0), "m2-pb": (2, 1), "m1-pb": (1, 1), "m0-pb": (0, 1)}
    rows = []
    for line in open(tiers_path):
        r = json.loads(line)
        d = r["date"]
        if d not in nums or len(r["tiers"]) < 9:
            continue
        cnt = {key[k]: (t["w"] or 0) + (t["ppw"] or 0) for k, t in r["tiers"].items()}
        rows.append(dict(date=d, white=nums[d][0], bonus=nums[d][1], counts=[cnt[t] for t in TIERS],
                         jackpot=r.get("jackpot"), cash=r.get("cash"), fmt=0))
    rows.sort(key=lambda x: x["date"])
    return rows


def load_mm_rows(tiers_path, new_format_start="2025-04-08"):
    tmap = {0: (5, 1), 1: (5, 0), 2: (4, 1), 3: (4, 0), 4: (3, 1), 5: (3, 0), 6: (2, 1), 7: (1, 1), 8: (0, 1)}
    rows = []
    for line in open(tiers_path):
        r = json.loads(line)
        dr = r["Drawing"]
        if not dr or not r.get("PrizeTiers"):
            continue
        cnt = {t: 0 for t in TIERS}
        for p in r["PrizeTiers"]:
            if p["Tier"] in tmap:
                cnt[tmap[p["Tier"]]] += p["Winners"] or 0
        jp = r.get("Jackpot") or {}
        rows.append(dict(date=r["date"], white=sorted([dr["N1"], dr["N2"], dr["N3"], dr["N4"], dr["N5"]]),
                         bonus=dr["MBall"], counts=[cnt[t] for t in TIERS], jackpot=jp.get("CurrentPrizePool"),
                         cash=jp.get("CurrentCashValue"), fmt=1 if r["date"] >= new_format_start else 0))
    rows.sort(key=lambda x: x["date"])
    return rows


def esym(w, deg=5):
    """Elementary symmetric polynomials e_0..e_deg over the last axis."""
    E = [torch.ones(w.shape[:-1])] + [torch.zeros(w.shape[:-1]) for _ in range(deg)]
    for i in range(w.shape[-1]):
        wi = w[..., i]
        for j in range(deg, 0, -1):
            E[j] = E[j] + wi * E[j - 1]
    return torch.stack(E, -1)


class PopularityModel:
    def __init__(self, rows, W, Bs, qp=0.7, fit_qp=False, lam=1.0):
        """Bs: bonus-ball count for each format group (rows carry 'fmt' as the group index)."""
        self.W, self.Bs = W, Bs
        self.D = torch.tensor([[n - 1 for n in r["white"]] for r in rows])
        self.b = torch.tensor([r["bonus"] - 1 for r in rows])
        self.f = torch.tensor([r.get("fmt", 0) for r in rows])
        self.n = torch.tensor([r["counts"] for r in rows], dtype=torch.float64)
        self.a = torch.zeros(W, requires_grad=True)
        self.cs = [torch.zeros(B, requires_grad=True) for B in Bs]
        self.q = torch.tensor(math.log(qp / (1 - qp)), requires_grad=fit_qp)
        self.fit_qp, self.lam = fit_qp, lam
        self.U = torch.tensor([math.comb(5, k) * math.comb(W - 5, 5 - k) / math.comb(W, 5) for k in range(6)])

    def weights(self):
        w = torch.exp(self.a - self.a.mean())
        vs = [torch.exp(c - c.mean()) for c in self.cs]
        return w, vs

    def probs(self):
        w, vs = self.weights()
        E = esym(w)
        eD = esym(w[self.D])
        eR = [torch.ones(len(self.D))]
        for j in range(1, 6):  # e_j of the undrawn numbers, by polynomial division
            eR.append(E[j] - sum(eD[:, i] * eR[j - i] for i in range(1, j + 1)))
        eR = torch.stack(eR, -1)
        H = torch.stack([eD[:, k] * eR[:, 5 - k] for k in range(6)], -1) / E[5]
        g = torch.zeros(len(self.D))
        Bv = torch.zeros(len(self.D))
        for fi, (v, B) in enumerate(zip(vs, self.Bs)):
            sel = self.f == fi
            g = torch.where(sel, (v / v.sum())[self.b.clamp(max=B - 1)], g)
            Bv = torch.where(sel, torch.full_like(Bv, B), Bv)
        qp = torch.sigmoid(self.q)
        s = 1 - qp
        cols = []
        for k, m in TIERS:
            if m == 1:
                cols.append(qp * self.U[k] / Bv + s * H[:, k] * g)
            else:
                cols.append(qp * self.U[k] * (Bv - 1) / Bv + s * H[:, k] * (1 - g))
        return torch.stack(cols, -1), w, vs

    def nll(self):
        P, _, _ = self.probs()
        N = self.n.sum(1) / P.sum(1)
        mu = N[:, None] * P
        ll = (self.n * torch.log(mu) - mu).sum()
        pen = self.lam * ((self.a - self.a.mean()) ** 2).sum()
        pen = pen + sum(self.lam * ((c - c.mean()) ** 2).sum() for c in self.cs)
        return -ll + pen

    def fit(self, iters=500):
        params = [self.a] + self.cs + ([self.q] if self.fit_qp else [])
        opt = torch.optim.LBFGS(params, lr=1, max_iter=iters, line_search_fn="strong_wolfe",
                                tolerance_grad=1e-10, tolerance_change=1e-14)

        def closure():
            opt.zero_grad()
            loss = self.nll()
            loss.backward()
            return loss

        opt.step(closure)
        return self

    def summary(self):
        with torch.no_grad():
            P, w, vs = self.probs()
            N = self.n.sum(1) / P.sum(1)
            mu = N[:, None] * P
            pearson = ((self.n - mu) ** 2 / mu).sum(0) / len(self.n)
            nll = float(self.nll().detach())
        return dict(w=w.numpy(), vs=[v.numpy() for v in vs], qp=float(torch.sigmoid(self.q).detach()),
                    N=N.numpy(), mu=mu.numpy(), P=P.numpy(), pearson=pearson.numpy(), nll=nll)


def inclusion_ratio(w):
    """P(a self-picked ticket contains n) / (5 / W): how much more often than an average number."""
    W = len(w)
    E = np.zeros(6)
    E[0] = 1
    for x in w:
        for j in range(5, 0, -1):
            E[j] += x * E[j - 1]
    out = []
    for i in range(W):
        e = [1.0]
        for j in range(1, 5):
            e.append(E[j] - w[i] * e[j - 1])
        out.append(w[i] * e[4] / E[5])
    return np.array(out) / (5 / W)
