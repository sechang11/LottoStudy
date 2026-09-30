# Powerball / Mega Millions per-draw sales data: notes

Compiled 2026-09-30. Read-only web research. All files are in this scratchpad directory.

| File | Rows | Date range | Notes |
|---|---|---|---|
| `powerball_sales.csv` | 1597 | 2014-01-01 .. 2026-09-28 | 1413 rows are in the current 5/69+1/26 matrix (from 2015-10-07). 184 rows from the old 5/59+1/35 matrix (2014-01-01..2015-10-03) are included for completeness. |
| `megamillions_sales.csv` | 1435 | 2013-01-01 .. 2026-09-29 | 155 rows are $5-era draws (from 2025-04-08). 776 rows are $2-era draws (2017-10-31..2025-04-04). 420 rows are $1 5/75+1/15 draws (2013-10-22..2017-10-27), and 84 rows use the pre-Oct-2013 5/56+1/46 matrix. |

Every drawn date in those ranges is present: the rows were checked one by one against the Texas Lottery's list of draw dates, and none are missing or extra. Draws that hadn't happened yet were left out: PB 2026-09-30 (advertised $409M, cash $170.2M) and MM 2026-10-02 (advertised $321M, cash $131.1M).

## Sources

1. **LottoReport.com** is the primary source for **sales**. It publishes national per-draw sales tables that it updates after each drawing.
   - Powerball: https://www.lottoreport.com/powerballsales.htm (2025-2026), `powerballsales2425.htm` (2024-25), `powerballsales2223.htm` (2022-23), `powerballsales5.htm` (2018-21), `powerballsales4.htm` (2014-17).
   - Mega Millions: https://www.lottoreport.com/mmsales.htm (2025-2026), `mmsales7.htm` (2023-24), `mmsales6.htm` (2021-22), `mmsales5.htm` (2017-20), `mmsales4.htm` (2013-16).
   - Cross-checks: `ticketcomparison*.htm` (LottoReport's own tickets-per-draw pages) and `PBSalesbystate.htm` (by-state PB / Power Play / Double Play sales).
   - Raw HTML copies are saved in `raw/`.
2. **Texas Lottery Commission** "Past Winning Numbers" pages, one per year (PB 2014-2026, MM 2013-2026), for example https://www.texaslottery.com/export/sites/lottery/Games/Powerball/Winning_Numbers/index.html and the `Mega_Millions` equivalent.
   - Used for: the canonical list of draw dates, `advertised_jackpot_musd` (the "Estimated Jackpot" column), and `jackpot_won` ("Roll" vs "Out of State Winner" or a Texas winner count). Raw copies are in `raw/tx/`.
3. **Official game sites** (per-draw jackpot, cash value and jackpot winners):
   - Powerball: powerball.com draw-result pages, `https://www.powerball.com/draw-result?gc=powerball&date=YYYY-MM-DD`, for all draws from 2015-10-07 on.
   - Mega Millions: the megamillions.com JSON service `cmspages/utilservice.asmx/GetDrawDataByTickWithMatrix`, for all draws from 2017-10-31 on.
   - A parallel collection job in this session had already downloaded these at about one request per second, into `data/pbcom_tiers.jsonl` and `data/mm_tiers.jsonl`. I re-used those files rather than hitting the servers a second time. Frozen copies are in `raw/official_snapshot/`.
4. **Wikipedia, "Lottery jackpot records"** (https://en.wikipedia.org/wiki/Lottery_jackpot_records) supplies the final annuity, cash and winner counts for jackpots of about $560M and up (`final_*` columns).
5. **News and official statements** supply reported coverage and ticket counts. See the big-draw section below.

## Column dictionary

All money columns ending in `_musd` are **millions of US dollars**. Columns ending in `_usd` are **whole dollars**.

Common columns:

| Column | Meaning |
|---|---|
| `draw_date`, `weekday` | Draw date (ISO format). PB draws Mon/Wed/Sat (Mondays from 2021-08-23); MM draws Tue/Fri. |
| `game_era` | Matrix and price regime. |
| `total_combinations` | Number of distinct jackpot combinations: PB 292,201,338 (175,223,510 before 2015-10-07); MM 290,472,336 (from 2025-04-08), 302,575,350 (2017-10-31..2025-04-04), 258,890,850 (2013-10-22..2017-10-27), 175,711,536 (before that). |
| `base_play_price_usd` | Price of one base play: PB $2; MM $1, $2 or $5 by era. |
| `advertised_jackpot_musd` | Texas Lottery's "Estimated Jackpot" for that draw. This is the advertised annuity estimate at draw time, i.e. **what players saw when buying**. |
| `lr_jackpot_first_musd`, `lr_jackpot_last_musd` | First and last values in LottoReport's jackpot cell. LottoReport often lists successive values, e.g. `$1.7 $1.8 B` or `$750 $687.8`. The first is the initial estimate announced after the previous draw. Later values are mid-week revisions and, for won draws, usually the final amount. The full text is in `lr_jackpot_raw`. |
| `final_jackpot_musd`, `final_cash_value_musd` | Final annuity and cash values for jackpot wins in the Wikipedia records table. Blank for other draws. |
| `jackpot_won` | 1 if the jackpot was hit, 0 if it rolled (Texas Lottery). |
| `jackpot_winners` | **National** number of jackpot-winning tickets. |
| `jackpot_winner_states` | States of the winning tickets, where known. |
| `jackpot_winners_source` | Where `jackpot_winners` came from: `powerball.com`, `megamillions.com`, `wikipedia`, or `texaslottery (Roll)`. Texas "Roll" means 0 winners. For older eras a won draw with no winner count leaves the column blank. |
| `base_sales_usd` | LottoReport national sales for the **base game only**. See the add-ons section. |
| `base_plays` | `base_sales_usd / base_play_price_usd`. LottoReport's own "tickets sold" pages use exactly the same division. |
| `plays_per_combination` | lambda = jackpot-eligible plays / `total_combinations`. |
| `coverage_pct_random_model` | 100·(1 − e^(−lambda)): the share of combinations covered **if every play were an independent uniform-random pick**. This is **computed, not published**, but it reproduces the Multi-State Lottery Association's (MUSL) published Powerball coverage figures exactly (see below). |
| `reported_pct_combos_covered`, `reported_tickets`, `reported_source` | Coverage or ticket counts actually published by officials or the press for that draw. Blank for most draws. |
| `lr_sales_revised_flag` | 1 if LottoReport marked the sales figure with `*` ("figure revised"). |
| `data_quality_flag` | `minor_typo` or `suspect`. The reason is in `notes`. |
| `notes` | Parsing fixes, data-quality remarks and special events. |

Powerball-only columns:

| Column | Meaning |
|---|---|
| `pbcom_jackpot_musd`, `pbcom_cash_value_musd` | The jackpot and cash value shown on powerball.com's page for that draw (2015-10-07 on). These are the **finalised values after sales**, not the pre-draw advertisement. For example, 2016-01-13 shows $1,590M against an advertised $1,500M, and 2018-10-27 shows $688M against an advertised $750M. The absolute gap from `advertised_jackpot_musd` has a median of 0.7% and a 95th percentile of 4.7%. Large gaps mean sales surprised the forecast; for example 2022-11-09 was advertised at $20M and finalised at $32M. |
| `powerplay_sales_usd` | LottoReport's Power Play add-on sales ($1 per play). |
| `base_plus_powerplay_sales_usd` | Sum of the two. **Double Play is not included anywhere.** |

Mega Millions-only columns:

| Column | Meaning |
|---|---|
| `mmcom_jackpot_musd`, `mmcom_cash_value_musd` | megamillions.com "CurrentPrizePool" and "CurrentCashValue" for that draw (2017-10-31 on). These are the **advertised pre-draw estimate**; they agree with Texas to within 3% on all 931 draws. Example: 2018-10-23 shows $1,600M / $913.7M, while the final was $1,537M / $877.8M. |
| `jtj_sales_usd` | "Just the Jackpot" sales (2017-10-31..2025-04-04). JTJ cost $3 for 2 jackpot-only plays; it was discontinued with the $5 game. |
| `jtj_plays` | `jtj_sales_usd × 2/3`. |
| `jackpot_eligible_plays` | `base_plays + jtj_plays`. This is the N to use for split-jackpot modelling. JTJ adds only about 0.1% (median). |

## Do the sales figures include add-ons?

**Powerball.** `base_sales_usd` is **$2 base plays only**. Power Play is excluded and is given separately in `powerplay_sales_usd`, typically about 11% of base. Double Play is also excluded; LottoReport tracks it separately on `PBSalesbystate.htm`. For example, on 2025-02-03 the figures were draw sales $16,813,488, Power Play $2,228,772 and Double Play $717,391. The evidence:

- LottoReport says to divide draw sales by two to get tickets.
- All but 3 of the 1597 published values are exact multiples of $2. A total that included $1 add-ons would be odd about half the time. The 3 odd values are source typos: 2 are flagged and 1 (2025-05-24) was corrected.
- MUSL's published coverage percentages come out exactly when N = `base_sales_usd`/2 is used: 77.8%, 88.6%, 36.3%, 46.6% and 62% (see table).

**Mega Millions, 2017-10-31..2025-04-04 ($2).** `base_sales_usd` **excludes the Megaplier ($1 add-on)**, and Just the Jackpot is listed separately. The evidence:

- 774 of 776 values are even; the 2 odd values are flagged.
- Gordon Medenica, the Mega Millions lead director, said "280 million tickets" were sold for 2018-10-19. LottoReport's $559.8M / 2 = 279.9M.

**Mega Millions, 2025-04-08 onward ($5).** The multiplier is built in and there are no add-ons, so `base_sales_usd` is total sales; every value is a multiple of $5. Plays = sales / 5.

**Mega Millions, 2013-2017 ($1).** LottoReport treats sales as $1 tickets (its ticket counts equal its sales). I believe the Megaplier is excluded, but this era could not be independently verified.

## How `coverage_pct_random_model` relates to published "% of combinations covered"

For Powerball, MUSL's published figures match 1 − e^(−N/C) with N = base_sales/2 to one decimal on every draw I could find:

| Draw | Published | Computed |
|---|---|---|
| 2016-01-09 | 77.8% | 77.84% |
| 2016-01-13 | 88.6% | 88.62% |
| 2022-10-31 | 36.3% | 36.27% |
| 2022-11-02 | 46.6% | 46.56% |
| 2022-11-05 | "62%" | 61.55% |

So you can treat the column as "the MUSL-style coverage number".

For Mega Millions the one official figure found (about 57% on 2018-10-19) is *below* the random-model value of 60.4%. Either MM counted actual distinct combinations, which self-picked numbers cluster and so reduce, or the figure pre-dated final sales.

For split modelling, suppose play is uniform random and you hold the winning combination:

- The number of *other* winning tickets K is Poisson with mean lambda = `plays_per_combination`.
- P(no split) = e^(−lambda).
- The expected share of the jackpot you keep is E[1/(1+K)] = (1 − e^(−lambda))/lambda.

Real play is not uniform. Quick picks are uniform, but hand-picked numbers such as birthdays and patterns cluster, so self-pickers split more often and quick-pickers slightly less.

## Known gaps and caveats

- **Winner counts and cash values.**
  - PB: from powerball.com for every draw from 2015-10-07 on (1413 of 1413 rows complete). Eighteen pages had come back empty in the bulk collection, so I re-fetched them one at a time (`pbcom_refetch.jsonl`, `raw/pbcom_refetch/`). The 2014-2015 old-matrix rows only have `jackpot_won`, plus Wikipedia values for 2015-02-11.
  - MM: from megamillions.com for every draw from 2017-10-31 on (all rows complete). Pre-2017 rows have `jackpot_won` only, plus Wikipedia values for 2013-12-17. Winners are 0 wherever Texas shows "Roll".
  - megamillions.com hasn't filled in winner states for some recent wins. Wikipedia filled 2025-11-14 and 2026-07-28, which leaves states blank for 2025-12-02, 2026-03-10 and 2026-03-17. The winner *counts* are present for all of them.
- **LottoReport transcription errors that were fixed.** Date typos are all recorded in `notes`:
  - `04/30/15` (→2025), `02/2424`, `12/23/24` (in the 2023 list), `07/26/16` and `07/29/16` (really 07/27 and 07/30).
  - MM: `07/19.22`, `06/10/11`, `06/17/21`, `02/11/21`, `01/23/23`, `01/14/24`, `08/03/17`.
  - Money typos: `$22-181-568` and `$35,823.628`.
  - A marker row ("UK Joins PB", dated 07/21/26) was dropped. Without that fix the whole 2026 PB table would have shifted by one draw.
- **Values corrected** (`data_quality_flag = corrected`; the original value is in `notes`):
  - **PB 2025-05-24.** The sales page shows $12,523,337. That is odd, so impossible for $2 plays, and about half of comparable Saturdays. It is exactly LottoReport's own *ticket count* for that draw, so base sales were set to 2 × 12,523,337 = $25,046,674.
  - **MM 2023-05-12.** The sales page shows $28,866,084, but LottoReport's ticket page implies $21,866,084. That is a one-digit typo, and the corrected value is consistent with neighbouring draws and with jackpot growth.
- **Every derived play count was cross-checked** against LottoReport's own "tickets sold per draw" pages for 2016, 2018 and 2023-2026, 1,349 draw-comparisons in all. Apart from the two corrected draws above, one mismatch is an error on the ticket page itself: for PB 2023-02-13 it repeats the dollar figure as the ticket count, so the sales page is right. Beyond those, 9 small disagreements remain (0.1-9%). They are flagged `lr_internal_discrepancy`, the sales-page value is kept, and both values are given in `notes`.
- **Values flagged but kept as published:**
  - Base sales that aren't a multiple of $2: PB 2016-09-10, 2025-01-06; MM 2019-02-19, 2025-04-04. These are small typos (`minor_typo`).
  - PB 2026-09-07's Power Play value ($9.3M, 50% of base) is suspect.
  - PB 2016-05-04's Power Play value is garbled on the source and is left blank.
- **The newest rows may be revised.** LottoReport posts figures "after each draw and as info is received" and later marks revisions with `*`.
- **Connecticut and Tennessee don't publish per-draw sales.** LottoReport says it obtains them elsewhere, so national totals may contain small estimates.
- **UK players.** According to LottoReport, UK players joined the Powerball jackpot pool from 2026-07-22 (UK players compete for the jackpot only). It isn't known whether UK sales are included in LottoReport's figures after that date. If UK plays are *not* included, N understates true jackpot-eligible plays for those draws. Rows from that date carry a note.
- **Dating quirks.** The 2022-11-07 PB drawing was delayed to the morning of 11-08. The 2024-04-06 PB drawing was held after midnight, and Wikipedia dates it 2024-04-07.
- **Advertised vs final jackpot.** For sales modelling use `advertised_jackpot_musd` (or `lr_jackpot_first_musd` for the earliest estimate). Final jackpots are known only after sales.
- **Sales patterns worth knowing.** Sales depend on more than the jackpot:
  - **Concurrent big jackpots in the other game raise sales.** Examples are PB in Oct 2018 during the MM $1.6B run, both games in Jan 2021, and MM in Jul 2023 during the PB $1B run.
  - **Draws right after a record run carry spillover.** PB 2022-11-09 sold $46M at a $20M jackpot, against roughly $22M normally.
  - **Weekday.** For 2022-2026 PB draws at similar jackpots, median plays for Wednesday are about 1.15-1.2× Monday, and Saturday about 1.6-1.7× Monday.
  - **Long-run downtrend in PB plays at the same jackpot size.** Median plays at a $300-600M advertised jackpot fell from about 41M in 2016 to 26M in 2019, 18M in 2022-23, 14M in 2025 and 13M in 2026. The record draws show the same pattern: 635M plays at $1.586B in 2016 against 129M plays at $1.765B in 2023.
  - **The MM $5 price change reduced plays sharply.** Compared with 2022-2025 $2-era draws at similar advertised jackpots, median plays fell by about 55% ($20-100M), 61% ($100-300M), 63% ($300-600M) and 78% ($600M-1.2B). Dollar sales were roughly flat for small jackpots but about 46% lower at $600M+.
  - **Consequence.** Fit sales against advertised jackpot **per era, with a time trend**, rather than pooling years.

## Headline numbers for the biggest draws

| Draw | Game | Advertised pre-draw | Final jackpot / cash | Jackpot winners | Base sales (LottoReport) | Jackpot-eligible plays | Plays / combos | Coverage % (random model) | Source-reported coverage / tickets |
|---|---|---|---|---|---|---|---|---|---|
| 2016-01-09 | PB | $900M | rolled | 0 | $880.6M | 440.3M | 1.507 | 77.8 | 77.8% |
| 2016-01-13 | PB | $1.500B | $1.586B / $983.5M cash | 3 (CA, FL, TN) | $1,270.2M | 635.1M | 2.174 | 88.6 | 88.6% |
| 2018-10-19 | MM | $1.000B | rolled | 0 | $559.8M | 280.2M | 0.926 | 60.4 | 57.0%, 280M tickets |
| 2018-10-23 | MM | $1.600B | $1.537B / $877.8M cash | 1 (SC) | $739.4M | 370.2M | 1.223 | 70.6 | see note |
| 2021-01-22 | MM | $1.000B | $1.050B / $776.6M cash | 1 (MI) | $366.9M | 183.6M | 0.607 | 45.5 | — |
| 2022-07-29 | MM | $1.280B | $1.337B / $780.5M cash | 1 (IL) | $703.6M | 352.2M | 1.164 | 68.8 | — |
| 2022-10-31 | PB | $1.000B | rolled | 0 | $263.3M | 131.7M | 0.451 | 36.3 | 36.3% |
| 2022-11-02 | PB | $1.200B | rolled | 0 | $366.2M | 183.1M | 0.627 | 46.6 | 46.6% |
| 2022-11-05 | PB | $1.600B | rolled | 0 | $558.5M | 279.3M | 0.956 | 61.5 | 62.0% |
| 2022-11-07 | PB | $1.900B | $2.040B / $997.6M cash | 1 (CA) | $551.8M | 275.9M | 0.944 | 61.1 | — |
| 2023-01-13 | MM | $1.350B | $1.350B / $724.6M cash | 1 (ME) | $345.9M | 173.1M | 0.572 | 43.6 | — |
| 2023-07-19 | PB | $1.000B | $1.080B / $558.1M cash | 1 (CA) | $240.7M | 120.4M | 0.412 | 33.8 | — |
| 2023-08-08 | MM | $1.580B | $1.602B / $794.2M cash | 1 (FL) | $343.0M | 171.7M | 0.567 | 43.3 | — |
| 2023-10-11 | PB | $1.720B | $1.765B / $774.1M cash | 1 (CA) | $258.5M | 129.2M | 0.442 | 35.8 | — |
| 2024-03-26 | MM | $1.130B | $1.130B / $537.5M cash | 1 (NJ) | $174.1M | 87.1M | 0.288 | 25.0 | — |
| 2024-04-06 | PB | $1.300B | $1.326B / $621M cash | 1 (OR) | $217.9M | 109.0M | 0.373 | 31.1 | — |
| 2024-12-27 | MM | $1.220B | $1.269B / $571.9M cash | 1 (CA) | $275.1M | 137.7M | 0.455 | 36.6 | — |
| 2025-09-06 | PB | $1.800B | $1.787B / $820.6M cash | 2 (MO, TX) | $489.1M | 244.6M | 0.837 | 56.7 | — |
| 2025-11-14 | MM | $980M | $980M / $452M cash | 1 (GA) | $117.6M | 23.5M | 0.081 | 7.8 | — |
| 2025-12-24 | PB | $1.700B | $1.817B / $834.9M cash | 1 (AR) | $311.1M | 155.6M | 0.532 | 41.3 | — |
| 2026-07-28 | MM | $800M | $800M / $344.2M cash | 1 (FL) | $71.1M | 14.2M | 0.049 | 4.8 | — |
| 2026-08-12 | PB | $1.000B | $1.040B / $450.5M cash | 1 (IL) | $157.2M | 78.6M | 0.269 | 23.6 | — |

Notes on the table:

- **Columns.**
  - "Advertised pre-draw" is Texas Lottery's estimate at draw time.
  - "Final jackpot / cash" comes from the Wikipedia records table. For Powerball, powerball.com's draw pages give the same final values (checked: 17 of 17 PB wins agree within 1%).
  - Sales, plays and coverage are LottoReport-derived and computed.
  - "Source-reported" is a figure actually published at the time.
- **Sources for published figures.**
  - AP via CBS SF, 2022-11-03, "Why no Powerball winner? It's luck and smaller sales": 88.6% for 2016-01-13, 77.8% for the ~$900M 2016-01-09 draw, 36.3% for 2022-10-31, 46.6% for the $1.2B 2022-11-02 draw. https://www.cbsnews.com/sanfrancisco/news/why-no-powerball-winner-its-luck-and-smaller-sales/
  - Fortune, 2022-11-07: "For Saturday night's drawing, that had climbed to 62%" (2022-11-05); summer 2022 draws covered less than 10%. https://fortune.com/2022/11/07/why-is-powerball-so-high-2-billion-lottery-jackpot/
  - NPR, 2018-10-24: Medenica said 280 million tickets were sold for the 2018-10-19 drawing; the $1.537B lump sum was "nearly $878 million"; "about 70 percent of sales occur on the drawing day". https://www.npr.org/2018/10/24/660094131/a-winning-ticket-in-s-c-for-1-6-billion-the-largest-jackpot-in-lottery-history
  - KING5/AP, October 2018: Medenica told the Washington Post about 57% of combinations were purchased before the 2018-10-19 drawing; about 75% of the 302M combinations were *projected* for 2018-10-23. The article page returned HTTP 403 to me, so these two figures come from search-engine excerpts of it. No post-draw figure for 10-23 was found. https://www.king5.com/article/news/nation-world/mega-millions-16-billion-jackpot-creates-frenzy-why-not-give-it-a-try/507-606607500
  - powerball.com press release, 2025-09-07: two tickets (MO, TX) split $1.787B, each $893.5M annuity or $410.3M cash. https://www.powerball.com/tickets-in-missouri-and-texas-win-1.787-billion-powerball-jackpot
  - Yahoo/AP, 2025-12-26: $1.817B PB (Cabot, AR; $834.9M cash, 2025-12-24); MM 2025-11-14 won in Newnan, GA, where "final sales pushed the total to $983 million", cash about $452.2M. Wikipedia lists $980M / $452M. https://www.yahoo.com/news/articles/powerball-mega-millions-end-trifecta-214745603.html
  - AP (WBTV etc.), 2026-08-13: 2026-08-12 PB won by a single ticket in Quincy, IL; the article says "$1 billion", with $433M as the pre-draw cash. Final per Wikipedia: $1.04B / $450.5M. https://www.wbtv.com/2026/08/13/powerball-jackpot-reaches-1-billion-heres-what-winner-could-take-home/
  - FOX13 / LotteryUSA, 2026-07-29: MM 2026-07-28 won by a single ticket in Bradenton, FL, $800M / $344.2M cash. These figures come from search-result excerpts and match Wikipedia. https://www.fox13news.com/news/winning-800-million-mega-millions-ticket-jackpot-florida
  - megamillions.com Trivia: 227 MM jackpots won by 254 tickets since 2002 (22 shared). https://www.megamillions.com/About/Mega-Millions-Trivia.aspx
- **No post-draw coverage figures were found** for 2018-10-23, 2022-11-07, 2023-08-08, 2023-10-11, 2025-09-06 or 2025-12-24. For those, rely on the computed column; for PB it is the same formula MUSL uses.

## Files used to build this (reproducibility)

- Scripts:
  - `lr_parse.py`, `extract_lr.py` and `build_rows.py` parse LottoReport.
  - `normalize2.py` aligns dates to the Texas draw list and repairs typos.
  - `parse_tx.py` parses the Texas pages.
  - `assemble.py` builds the CSVs, `headline_table.py` builds the table above, and `fill_notes.py` fills this note.
  - `refetch_pbcom.py` re-fetched the 18 empty powerball.com pages.
- Inputs:
  - `reported_figures.json` holds the news-reported coverage and ticket figures.
  - `final_values_wiki.json` holds the Wikipedia final values.
  - `tx_rows.json` holds the parsed Texas pages.
  - `raw/official_snapshot/*.jsonl` holds the powerball.com and megamillions.com per-draw data.

To rebuild: run `python normalize2.py`, then `python assemble.py`, then `python fill_notes.py`.
