"""Assemble the site into one self-contained file.

    python build.py

Reads src/page.html and inlines src/styles.css, data/site-data.json, src/core.js and src/app.js.
Writes:
  index.html              standalone page (open it in any browser, or host it anywhere)
  dist/artifact.html      the same page without the <html>/<head>/<body> wrapper, for claude.ai Artifacts
"""
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


def read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


def main():
    page = read("src/page.html")
    data = json.loads(read("data/site-data.json"))
    head = (
        "<title>Lottery Edge Lab</title>\n"
        '<meta name="description" content="Can AI beat the lottery? An honest, data-driven look at '
        'Powerball and Mega Millions: expected value, jackpot splitting, number popularity and ticket spreading.">\n'
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
