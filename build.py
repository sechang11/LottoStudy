"""Assemble the site into one self-contained file.

    python build.py

Reads src/page.html and inlines src/styles.css, data/site-data.json, src/core.js and src/app.js.
Renders data/winners.json (studies and winner stories) into static HTML.
Writes:
  index.html              standalone page (open it in any browser, or host it anywhere)
  dist/artifact.html      the same page without the <html>/<head>/<body> wrapper, for claude.ai Artifacts
"""
import html
import json
import pathlib

ROOT = pathlib.Path(__file__).parent
FONTS = (
    '<link rel="preconnect" href="https://fonts.googleapis.com">'
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?'
    'family=Atkinson+Hyperlegible+Mono:wght@400;600&'
    'family=Libre+Franklin:ital,wght@0,400;0,500;0,700;0,800;1,400&'
    'family=Big+Shoulders+Display:wght@800;900&'
    'family=Doto:wght@900&display=swap">'
)
DIRECTION = {"better": "Better", "worse": "Worse", "mixed": "Studies disagree", "none": "No clear change", "shift": "Neutral shift"}
GROUPS = [
    ("good", "The good", "✓"),
    ("mixed", "The mixed", "~"),
    ("bad", "The bad", "!"),
    ("ugly", "The ugly", "✕"),
    ("quiet", "The quiet", "·"),
]


def read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


def esc(s):
    return html.escape(str(s), quote=True)


def links(sources):
    return "".join(f'<a href="{esc(s["url"])}" rel="noopener">{esc(s["label"])}</a>' for s in sources)


def render_winners(w):
    research = "\n".join(
        f'    <div class="study"><div class="outcome">{esc(r["outcome"])}</div>'
        f'<span class="dir {esc(r["direction"])}">{esc(r.get("label") or DIRECTION[r["direction"]])}</span>'
        f'<div class="what"><p>{esc(r["finding"])}</p><span class="cite">{esc(r["study"])} {links(r.get("sources", []))}</span></div></div>'
        for r in w["research"]
    ) + (f'\n    <p class="study-note">{esc(w["researchNote"])}</p>' if w.get("researchNote") else "")
    m = w["myth"]
    myth = (f'  <div class="myth"><div class="stamp" aria-hidden="true">{esc(m["stamp"])}</div>'
            f'<p><b>{esc(m["title"])}</b> {esc(m["text"])} <span class="src">{links(m["sources"])}</span></p></div>')
    counts = {k: sum(1 for s in w["stories"] if s["verdict"] == k) for k, _, _ in GROUPS}
    filters = [f'      <button type="button" data-filter="all" aria-pressed="true">All {len(w["stories"])}</button>']
    filters += [f'      <button type="button" data-filter="{k}" aria-pressed="false">{label.split()[1].title()} {counts[k]}</button>'
                for k, label, _ in GROUPS if counts[k]]
    groups = []
    for key, label, icon in GROUPS:
        items = sorted((s for s in w["stories"] if s["verdict"] == key),
                       key=lambda s: int(s["year"][:4]) if s["year"][:4].isdigit() else 9999)
        if not items:
            continue
        cards = []
        for s in items:
            meta = " · ".join(esc(x) for x in (s["year"], s["place"], s["game"], s["prize"]) if x)
            rows = "".join(f"<dt>{esc(t)}</dt><dd>{esc(s[k])}</dd>" for t, k in (("Before", "before"), ("After", "after"), ("Latest reported", "latest")) if s.get(k))
            cards.append(
                f'      <article class="winner {key}"><div class="winner-head"><h5>{esc(s["name"])}</h5>'
                f'<span class="verdict-tag {key}"><i aria-hidden="true">{icon}</i>{esc(label.split()[1].title())}</span>'
                f'<span class="meta">{meta}</span></div><p class="gist">{esc(s["gist"])}</p>'
                f'<details class="story-more"><summary>Full story and sources</summary><dl>{rows}</dl>'
                f'<div class="src">Sources: {links(s["sources"])}</div></details></article>')
        groups.append(
            f'  <div class="story-group" data-group="{key}"><h4>{esc(label)} <span class="n">{len(items)}</span></h4>'
            f'<p class="muted">{esc(w["groupNotes"][key])}</p>\n    <div class="winner-grid">\n' + "\n".join(cards) + "\n    </div>\n  </div>")
    return {
        "<!--WINNER_RESEARCH-->": research,
        "<!--WINNER_MYTH-->": myth,
        "<!--WINNER_FILTERS-->": "\n".join(filters),
        "<!--WINNER_STORIES-->": "\n".join(groups),
        "<!--WINNER_METHOD-->": esc(w["method"]),
    }


def main():
    page = read("src/page.html")
    data = json.loads(read("data/site-data.json"))
    winners = ROOT / "data" / "winners.json"
    if winners.exists():
        for key, value in render_winners(json.loads(winners.read_text(encoding="utf-8"))).items():
            page = page.replace(key, value)
    head = (
        "<title>Lottery Edge Lab</title>\n"
        '<meta name="description" content="Can AI beat the lottery? An honest, data-driven look at '
        'Powerball and Mega Millions: expected value, jackpot splitting, number popularity, ticket spreading '
        'and what happens to winners.">\n'
        + FONTS + "\n<style>\n" + read("src/styles.css") + "\n</style>\n"
    )
    scripts = (
        "<script>window.LOTTO_DATA = " + json.dumps(data, separators=(",", ":")) + ";</script>\n"
        "<script>\n" + read("src/core.js") + "\n</script>\n"
        "<script>\n" + read("src/app.js") + "\n</script>\n"
    )
    body = page.replace("<!--SCRIPTS-->", scripts)

    fragment = head + body
    standalone = (
        '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
        + head + "</head>\n<body>\n" + body + "\n</body>\n</html>\n"
    )
    (ROOT / "index.html").write_text(standalone, encoding="utf-8")
    (ROOT / "dist").mkdir(exist_ok=True)
    (ROOT / "dist" / "artifact.html").write_text(fragment, encoding="utf-8")
    print(f"index.html {len(standalone) / 1024:.0f} KB, dist/artifact.html {len(fragment) / 1024:.0f} KB")


if __name__ == "__main__":
    main()
