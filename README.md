# Lottery Edge Lab

An honest, data-driven answer to "can AI give us an edge in the lottery?" for Powerball and Mega Millions.
Short version: no. A ticket never pays for itself after taxes and jackpot splits. The site measures the
three small levers that do exist and gives you tools to use them.

Open `index.html` in any browser. It's one self-contained file, so you can send it to someone or host it anywhere.

## What's inside

| Section | What it does |
|---|---|
| Ticket value | Expected value per ticket for any jackpot, state and way of picking numbers, with taxes, cash option and jackpot splitting |
| Spread builder | Generates N tickets with no repeated bonus balls, no shared pairs of white balls, and numbers the crowd avoids |
| Crowd check | Estimates how many other people hold your exact numbers and flags popular patterns |
| What people pick | Number popularity measured from 2,327 draws of prize-winner counts |
| Randomness | Frequency and hot/cold tests on 2,345 draws |
| Real edges | Mandel, Cash WinFall, Lotto Texas 2023 and others, plus why none of them work on Powerball or Mega Millions |
| Winners | What large studies say happens to winners, plus sourced good, mixed, bad and ugly stories (`data/winners.json`) |

## Project layout

```
index.html                  the built site (open this)
dist/artifact.html          same page without the html/head/body wrapper, for claude.ai Artifacts
build.py                    inlines src/ + data/site-data.json into index.html
src/page.html, styles.css   markup and styling
src/core.js                 all the math (EV, splitting, popularity model, ticket generator); runs in Node too
src/app.js                  page behavior and charts
data/site-data.json         fitted models and summaries the page embeds
data/games.json             prize tables and current jackpots (edit these to update the jackpot sign)
data/states.json            2026 state tax rates on a jackpot-size win
data/raw/                   the raw public data (winning numbers, prize-tier winners, per-draw sales)
analysis/fetch_data.py      re-downloads the raw data
analysis/prepare_site_data.py  fits the popularity and sales models, writes data/site-data.json
tools/check-core.js         sanity checks for the math
```

## Rebuild

These commands are for Windows PowerShell, run from the project folder. After editing anything in `src/` or `data/`:

```powershell
python build.py
```

To refresh the data and refit the models (the scrapes take about 40 minutes and are polite, ~1 request/second):

```powershell
python analysis\fetch_data.py draws
```

```powershell
python analysis\fetch_data.py powerball
```

```powershell
python analysis\fetch_data.py megamillions
```

```powershell
python analysis\prepare_site_data.py
```

Model fitting needs `numpy`, `scipy` and `torch`. Check the math with `node tools\check-core.js`.

Data as of September 30, 2026. Not financial advice.

## Hosting

The `Dockerfile` serves `index.html` with Python's static server on Railway's `$PORT`. Rebuild with `python build.py` and commit `index.html` before deploying.
