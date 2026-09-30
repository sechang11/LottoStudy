"""Fit every model the site uses and write data/site-data.json.

    python analysis/prepare_site_data.py

Inputs (data/raw/):
  pb_draws.json, mm_draws.json         winning numbers, NY Open Data (data.ny.gov)
  pbcom_tiers.jsonl                    national winners per prize tier, powerball.com draw pages
  mm_tiers.jsonl                       winners per prize tier, megamillions.com draw data
  powerball_sales.csv, megamillions_sales.csv   per-draw sales (LottoReport.com, Texas Lottery)
  ../states.json, ../games.json        hand-entered tax table and game rules (with sources)
"""
import csv
import json
import math
import pathlib
import sys
import warnings

import numpy as np
from scipy import stats

warnings.filterwarnings("ignore")
ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "analysis"))
from popularity_model import PopularityModel, inclusion_ratio, load_mm_rows, load_pb_rows  # noqa: E402

RAW = ROOT / "data" / "raw"
QP_SHARE = 0.70  # share of quick-pick tickets assumed when reading the tier counts


def draws_string(path, kind):
    out = []
    for x in sorted(json.load(open(path)), key=lambda r: r["draw_date"]):
        d = x["draw_date"][:10].replace("-", "")
        n = [int(v) for v in x["winning_numbers"].split()]
        if kind == "mm":
            n = n + [int(x["mega_ball"])]
        out.append(d + ":" + ",".join(map(str, n)))
    return ";".join(out)


def load_draws(path, kind, start):
    out = []
    for x in json.load(open(path)):
        d = x["draw_date"][:10]
        if d < start:
            continue
        n = [int(v) for v in x["winning_numbers"].split()]
        whites, bonus = (sorted(n[:5]), n[5]) if kind == "pb" else (sorted(n), int(x["mega_ball"]))
        out.append((d, whites, bonus))
    return sorted(out)


def randomness(draws, W, B, bonus_start=None):
    counts = np.zeros(W, int)
    for _, w, _ in draws:
        for n in w:
            counts[n - 1] += 1
    chi2, p = stats.chisquare(counts)
    bd = [b for d, _, b in draws if bonus_start is None or d >= bonus_start]
    bc = np.bincount(bd, minlength=B + 1)[1:B + 1]
    chi2b, pb = stats.chisquare(bc)
    hot, cold, rep = [], [], []
    for t in range(100, len(draws)):
        f = np.zeros(W)
        for _, w, _ in draws[t - 100:t]:
            for n in w:
                f[n - 1] += 1
        order = np.argsort(-f, kind="stable") + 1
        cur = set(draws[t][1])
        hot.append(len(cur & set(order[:10])))
        cold.append(len(cur & set(order[-10:])))
        rep.append(len(cur & set(draws[t - 1][1])))
    half = len(draws) // 2

    def freq(ds):
        f = np.zeros(W)
        for _, w, _ in ds:
            for n in w:
                f[n - 1] += 1
        return f

    r_half, p_half = stats.pearsonr(freq(draws[:half]), freq(draws[half:]))
    r_oe, p_oe = stats.pearsonr(freq(draws[0::2]), freq(draws[1::2]))
    return dict(n_draws=len(draws), first=draws[0][0], last=draws[-1][0], white_counts=counts.tolist(),
                expected=len(draws) * 5 / W, chi2=float(chi2), p=float(p), df=W - 1,
                max_ball=int(counts.argmax()) + 1, max_count=int(counts.max()),
                min_ball=int(counts.argmin()) + 1, min_count=int(counts.min()),
                bonus_n=len(bd), bonus_chi2=float(chi2b), bonus_p=float(pb),
                hot=float(np.mean(hot)), cold=float(np.mean(cold)), chance=5 * 10 / W,
                hot_se=float(np.std(hot) / math.sqrt(len(hot))), n_backtest=len(hot),
                repeat=float(np.mean(rep)), repeat_chance=25 / W,
                half_r=float(r_half), half_p=float(p_half), oddeven_r=float(r_oe), oddeven_p=float(p_oe))


def sales_rows(path, start, end="9999-12-31"):
    out = []
    for r in csv.DictReader(open(path)):
        d = r["draw_date"]
        if not (start <= d <= end):
            continue
        try:
            A = float(r["advertised_jackpot_musd"]) * 1e6
            n = float(r["base_plays"])
        except (TypeError, ValueError):
            continue
        if A > 0 and n > 0:
            out.append((d, A, n))
    return out


def sales_knots(rows, edges):
    """Median ln(plays) against median ln(jackpot) in each jackpot band, forced non-decreasing."""
    A = np.array([r[1] for r in rows])
    n = np.array([r[2] for r in rows])
    knots = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        s = (A >= lo) & (A < hi)
        if s.sum() >= 3:
            knots.append([float(np.log(np.median(A[s]))), float(np.log(np.median(n[s]))), int(s.sum())])
    for i in range(1, len(knots)):
        knots[i][1] = max(knots[i][1], knots[i - 1][1])
    return knots


def main():
    games = json.load(open(ROOT / "data" / "games.json"))
    states = json.load(open(ROOT / "data" / "states.json"))
    out = {"asOf": games["asOf"], "games": [], "popularity": {}, "evidence": {}, "randomness": {}, "draws": {},
           "validation": {}, "states": states["states"]}

    # ---- popularity models ----
    pb_rows = load_pb_rows(RAW / "pb_draws.json", RAW / "pbcom_tiers.jsonl")
    mm_rows = load_mm_rows(RAW / "mm_tiers.jsonl")
    fits = {}
    fits["pb"] = PopularityModel(pb_rows, 69, [26], qp=QP_SHARE).fit().summary()
    fits["mm"] = PopularityModel(mm_rows, 70, [25, 24], qp=QP_SHARE).fit().summary()
    sens = {}
    for qp in (0.6, 0.8):
        s = PopularityModel(pb_rows, 69, [26], qp=qp).fit().summary()
        sens[qp] = inclusion_ratio(s["w"])
    free = PopularityModel(pb_rows, 69, [26], qp=QP_SHARE, fit_qp=True).fit().summary()

    for gid, rows, W in (("pb", pb_rows, 69), ("mm", mm_rows, 70)):
        f = fits[gid]
        v = f["vs"][-1]  # current bonus-ball format
        out["popularity"][gid] = {"qp": QP_SHARE, "w": [round(float(x), 5) for x in f["w"]],
                                  "v": [round(float(x), 5) for x in v]}
        incl = inclusion_ratio(f["w"])
        out["evidence"][gid] = {"white": [round(float(x), 4) for x in incl],
                                "bonus": [round(float(x / v.mean()), 4) for x in v],
                                "draws": len(rows), "first": rows[0]["date"], "last": rows[-1]["date"],
                                "pearson": [round(float(x), 2) for x in f["pearson"]]}
    out["evidence"]["pb"]["sensitivity"] = {
        "qp60": [round(float(x), 3) for x in sens[0.6]], "qp80": [round(float(x), 3) for x in sens[0.8]],
        "free_qp": round(free["qp"], 3)}

    # ---- sales: model plays vs reported plays (validation) and plays-vs-jackpot knots ----
    val = {}
    for gid, rows, path in (("pb", pb_rows, RAW / "powerball_sales.csv"), ("mm", mm_rows, RAW / "megamillions_sales.csv")):
        rep = {d: n for d, _, n in sales_rows(path, "2015-01-01")}
        ratios = [fits[gid]["N"][i] / rep[r["date"]] for i, r in enumerate(rows) if r["date"] in rep and r["date"] < "2026-07-22"]
        val[gid] = {"n": len(ratios), "median": float(np.median(ratios)),
                    "q25": float(np.percentile(ratios, 25)), "q75": float(np.percentile(ratios, 75))}
    out["validation"] = val

    edges = [0, 30e6, 50e6, 75e6, 100e6, 150e6, 200e6, 300e6, 400e6, 550e6, 700e6, 900e6, 1.2e9, 1.5e9, 3e9]
    knots = {"pb": sales_knots(sales_rows(RAW / "powerball_sales.csv", "2021-08-23"), edges),
             "mm": sales_knots(sales_rows(RAW / "megamillions_sales.csv", "2025-04-08"), edges)}

    # ---- evidence: birthday effect, from reported sales (independent of the model) ----
    rep = {d: n for d, _, n in sales_rows(RAW / "powerball_sales.csv", "2015-10-07", "2026-07-21")}
    U = [math.comb(5, k) * math.comb(64, 5 - k) / math.comb(69, 5) for k in range(6)]
    p3plus = sum(U[k] for k in (3, 4, 5))
    obs = np.zeros(6)
    exp = np.zeros(6)
    cnt = np.zeros(6, int)
    for r in pb_rows:
        if r["date"] not in rep:
            continue
        k = sum(1 for x in r["white"] if x <= 31)
        o = r["counts"][0] + r["counts"][1] + r["counts"][2] + r["counts"][3] + r["counts"][4] + r["counts"][5]
        obs[k] += o
        exp[k] += rep[r["date"]] * p3plus
        cnt[k] += 1
    out["evidence"]["pb"]["byBirthday"] = [{"k": k, "draws": int(cnt[k]), "ratio": round(float(obs[k] / exp[k]), 3)}
                                           for k in range(6) if cnt[k] >= 10]

    # ---- randomness ----
    pb_d = load_draws(RAW / "pb_draws.json", "pb", "2015-10-07")
    mm_d = load_draws(RAW / "mm_draws.json", "mm", "2017-10-31")
    out["randomness"]["pb"] = randomness(pb_d, 69, 26)
    out["randomness"]["mm"] = randomness(mm_d, 70, 24, bonus_start="2025-04-08")
    out["draws"]["pb"] = draws_string(RAW / "pb_draws.json", "pb")
    out["draws"]["mm"] = draws_string(RAW / "mm_draws.json", "mm")

    # ---- games ----
    for g in games["games"]:
        g = dict(g)
        g["sales"] = {"knots": [k[:2] for k in knots[g["id"]]], "bands": [k[2] for k in knots[g["id"]]], "maxSlope": 2.5}
        out["games"].append(g)

    (ROOT / "data" / "site-data.json").write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")

    # ---- console report (numbers quoted in the page copy) ----
    for gid in ("pb", "mm"):
        e = out["evidence"][gid]
        o = np.argsort(e["white"])[::-1]
        print(gid.upper(), "draws", e["draws"], e["first"], "->", e["last"])
        print("  most picked ", [(int(i + 1), e["white"][i]) for i in o[:10]])
        print("  least picked", [(int(i + 1), e["white"][i]) for i in o[-10:]])
        ob = np.argsort(e["bonus"])[::-1]
        print("  bonus most", [(int(i + 1), e["bonus"][i]) for i in ob[:6]], "least", [(int(i + 1), e["bonus"][i]) for i in ob[-4:]])
        w = np.array(e["white"])
        print("  mean ratio 1-31: %.2f, 32-end: %.2f" % (w[:31].mean(), w[31:].mean()))
        print("  pearson", e["pearson"])
        print("  validation plays model/reported", val[gid])
        print("  sales knots", [(round(math.exp(a) / 1e6), round(math.exp(b) / 1e6, 1), n) for a, b, n in knots[gid]])
        r = out["randomness"][gid]
        print("  randomness", {k: (round(v, 4) if isinstance(v, float) else v) for k, v in r.items() if k != "white_counts"})
    print("PB byBirthday", out["evidence"]["pb"]["byBirthday"])
    print("PB sensitivity 7:", out["evidence"]["pb"]["white"][6], "qp60", sens[0.6][6], "qp80", sens[0.8][6], "free qp", free["qp"])


if __name__ == "__main__":
    main()
