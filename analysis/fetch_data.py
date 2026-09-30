"""Download the public data behind the site into data/raw/.

    python analysis/fetch_data.py draws          # winning numbers (NY Open Data), a few seconds
    python analysis/fetch_data.py powerball      # prize-tier winners per draw, powerball.com (~25 min)
    python analysis/fetch_data.py megamillions   # prize-tier winners per draw, megamillions.com (~15 min)

The two scrapers wait ~0.8 s between requests and resume where they left off, so re-running only
fetches draws that are missing. Per-draw sales (powerball_sales.csv, megamillions_sales.csv) were
compiled separately from LottoReport.com and the Texas Lottery; see data/raw/SALES_NOTES.md.
"""
import datetime
import html
import json
import pathlib
import re
import sys
import time
import urllib.request

RAW = pathlib.Path(__file__).resolve().parents[1] / "data" / "raw"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
PAUSE = 0.8


def get(url, data=None, headers=None, tries=4):
    for _ in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": UA, **(headers or {})})
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read().decode("utf-8", "ignore")
        except Exception as e:  # network hiccups: wait and retry
            print("retry", url, e, file=sys.stderr)
            time.sleep(5)
    return None


def draws():
    for name, rid in (("pb_draws.json", "d6yy-54nr"), ("mm_draws.json", "5xaw-6ayf")):
        txt = get(f"https://data.ny.gov/resource/{rid}.json?$limit=50000&$order=draw_date")
        (RAW / name).write_text(txt, encoding="utf-8")
        print(name, len(json.loads(txt)), "draws")


def _done(path, key):
    seen = set()
    if path.exists():
        for line in path.open():
            try:
                seen.add(json.loads(line)[key])
            except (ValueError, KeyError):
                pass
    return seen


def _num(x):
    x = x.strip().replace(",", "").replace("$", "")
    try:
        return int(float(x))
    except ValueError:
        return None


def parse_powerball_page(s):
    rec = {}
    for key, label in (("jackpot", "Estimated Jackpot:"), ("cash", "Cash Value:")):
        m = re.search(re.escape(label) + r"\s*</span>\s*<span>\$([\d\.,]+)\s*(Million|Billion)", s)
        if m:
            rec[key] = float(m.group(1).replace(",", "")) * (1e6 if m.group(2) == "Million" else 1e9)
    m = re.search(r"JACKPOT WINNERS\s*</[^>]+>\s*(?:<[^>]+>\s*)*([^<]+)", s)
    if m:
        rec["jp_winners_text"] = html.unescape(m.group(1)).strip()
    tiers = {}
    start = s.find("winners-table")
    if start >= 0:
        body = s[start:s.find("</table>", start)]
        for row in re.findall(r"<tr>(.*?)</tr>", body, flags=re.S):
            m = re.search(r'item-powerball (m\d(?:-pb)?)"', row)
            if not m:
                continue
            cells = dict(re.findall(r'data-label="([^"]+)">\s*(.*?)\s*</td>', row, flags=re.S))
            tiers[m.group(1)] = {"w": _num(cells.get("Powerball Winners", "")), "p": cells.get("Powerball Prize", "").strip(),
                                 "ppw": _num(cells.get("Power Play Winners", "")), "ppp": cells.get("Power Play Prize", "").strip()}
    rec["tiers"] = tiers
    return rec


def powerball():
    dates = [d["draw_date"][:10] for d in json.load(open(RAW / "pb_draws.json")) if d["draw_date"][:10] >= "2015-10-07"]
    out = RAW / "pbcom_tiers.jsonl"
    done = _done(out, "date")
    with out.open("a") as f:
        for i, dt in enumerate(dates):
            if dt in done:
                continue
            s = get(f"https://www.powerball.com/draw-result?gc=powerball&date={dt}")
            if s:
                rec = parse_powerball_page(s)
                rec["date"] = dt
                f.write(json.dumps(rec) + "\n")
                f.flush()
            if i % 50 == 0:
                print(i, "/", len(dates), dt, flush=True)
            time.sleep(PAUSE)


def megamillions():
    dates = [d["draw_date"][:10] for d in json.load(open(RAW / "mm_draws.json")) if d["draw_date"][:10] >= "2017-10-31"]
    out = RAW / "mm_tiers.jsonl"
    done = _done(out, "date")
    with out.open("a") as f:
        for i, d in enumerate(dates):
            if d in done:
                continue
            dt = datetime.datetime.strptime(d, "%Y-%m-%d")
            ticks = int((dt - datetime.datetime(1, 1, 1)).total_seconds() * 10**7)  # .NET ticks
            s = get("https://www.megamillions.com/cmspages/utilservice.asmx/GetDrawDataByTickWithMatrix",
                    data=json.dumps({"PlayDateTicks": str(ticks)}).encode(),
                    headers={"Content-Type": "application/json; charset=utf-8"})
            if s:
                r = json.loads(json.loads(s)["d"])
                rec = {"date": d, "Drawing": r.get("Drawing"), "Jackpot": r.get("Jackpot"), "PrizeTiers": r.get("PrizeTiers"),
                       "MatchWinners": r.get("MatchWinners"), "MatrixID": (r.get("PrizeMatrix") or {}).get("MatrixID")}
                f.write(json.dumps(rec) + "\n")
                f.flush()
            if i % 50 == 0:
                print(i, "/", len(dates), d, flush=True)
            time.sleep(PAUSE)


if __name__ == "__main__":
    RAW.mkdir(parents=True, exist_ok=True)
    {"draws": draws, "powerball": powerball, "megamillions": megamillions}[sys.argv[1]]()
