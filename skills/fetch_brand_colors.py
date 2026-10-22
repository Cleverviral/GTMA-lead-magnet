"""Find the PROSPECT's brand colour for a custom magnet page (ruling 89), or fall back to the
ember-orange default. Free: reads the prospect's own homepage, its stylesheets and its logo.

Where the colour comes from, first usable one wins:
  1. <meta name="theme-color"> (or msapplication-TileColor) on the homepage
  2. the main colour of the prospect's logo (the same file the fetch_logo kit returns)
  3. a CSS custom property named like the brand (--primary, --brand, --accent, --main ...)
  4. the most used colour across the homepage's CSS (at least 5 uses)
Website-builder and widget-library preset colours (WordPress palette, favicon-generator tile
colours, Bootstrap, select2 ...) never count. A site that blocks plain downloads is retried
the way curl fetches it; if the homepage still fails, the logo route alone is tried.

The quality gate, applied to every candidate: a real colour (saturation 0.30 or more), not
near-white or near-black (lightness 0.15 to 0.80). A colour that passes but is too light for
white button text is darkened, same hue, until it reads (contrast 3:1 or better with white).
Nothing passes -> the ember-orange default (#ea580c), source = "default".

Usage:  python3 fetch_brand_colors.py example.com
        brand_palette(domain, html=<homepage html>)   # skips re-downloading the homepage
"""
import colorsys, io, re, sys, urllib.parse, urllib.request
from collections import Counter

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128 Safari/537.36"
DEFAULT = {"accent": "#ea580c", "accent2": "#f97316", "tag": "#fff7ed", "source": "default", "picked": None}
PRESETS = {  # builder palettes that say nothing about the brand
    "#00d084", "#0693e3", "#9b51e0", "#cf2e2e", "#ff6900", "#fcb900", "#7bdcb5", "#8ed1fc",
    "#abb8c3", "#f78da7", "#eb144c", "#313131", "#32373c", "#0073aa", "#005177", "#2271b1",
    "#135e96", "#1e73be", "#007bff", "#6c757d", "#28a745", "#dc3545", "#ffc107", "#17a2b8",
    "#0d6efd", "#198754", "#0dcaf0", "#6610f2", "#6f42c1", "#d63384", "#fd7e14", "#20c997",
    # favicon-generator / Windows tile defaults, and common widget libraries (select2, etc.)
    "#da532c", "#2b5797", "#00aba9", "#2d89ef", "#603cba", "#9f00a7", "#b91d47", "#ffc40d",
    "#1e7145", "#ee1111", "#5897fb", "#3875d7"}
BRAND_VAR = re.compile(r"--[\w-]*(?:primary|brand|accent|main|theme)[\w-]*\s*:\s*(#[0-9a-fA-F]{3,6}\b|rgba?\([^)]*\))")


def _get(url, limit=1_500_000, timeout=15):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read(limit), r.geturl()
    except Exception:
        import subprocess
        out = subprocess.run(["curl", "-sL", "--max-time", str(timeout), "-A", UA, "-w", "\n%{url_effective}", url],
                             capture_output=True, timeout=timeout + 5).stdout
        body, _, final = out.rpartition(b"\n")
        if not body.strip():
            raise
        return body[:limit], final.decode() or url


def _hex(v):
    v = v.strip().lower()
    m = re.fullmatch(r"#([0-9a-f]{3}|[0-9a-f]{6})", v)
    if m:
        h = m.group(1)
        return "#" + ("".join(c * 2 for c in h) if len(h) == 3 else h)
    m = re.fullmatch(r"rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)(?:[ ,/]+([\d.]+%?))?\s*\)", v)
    if m:
        if m.group(4) and not m.group(4).endswith("%") and float(m.group(4)) < 0.5:
            return None
        return "#%02x%02x%02x" % tuple(min(255, int(m.group(i))) for i in (1, 2, 3))
    return None


def _rgb(h):
    return tuple(int(h[i:i + 2], 16) / 255 for i in (1, 3, 5))


def _lum(h):
    c = [x / 12.92 if x <= 0.03928 else ((x + 0.055) / 1.055) ** 2.4 for x in _rgb(h)]
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


def contrast_white(h):
    return 1.05 / (_lum(h) + 0.05)


def gate(h):
    """None if the colour is unusable, else the (possibly darkened) hex."""
    if not h or h in PRESETS:
        return None
    hh, l, s = colorsys.rgb_to_hls(*_rgb(h))
    if s < 0.30 or not (0.15 <= l <= 0.80):
        return None
    while contrast_white(h) < 3.0 and l > 0.15:
        l -= 0.03
        h = "#%02x%02x%02x" % tuple(round(x * 255) for x in colorsys.hls_to_rgb(hh, l, s))
    return h if contrast_white(h) >= 3.0 else None


def _shade(h, l_new, s_scale=1.0):
    hh, _, s = colorsys.rgb_to_hls(*_rgb(h))
    return "#%02x%02x%02x" % tuple(round(x * 255) for x in colorsys.hls_to_rgb(hh, l_new, min(1, s * s_scale)))


def _logo_colour(png_bytes):
    try:
        from PIL import Image
        im = Image.open(io.BytesIO(png_bytes)).convert("RGBA").resize((64, 64))
    except Exception:
        return None
    counts = Counter()
    for r, g, b, a in im.getdata():
        if a < 128:
            continue
        hx = "#%02x%02x%02x" % (r // 8 * 8, g // 8 * 8, b // 8 * 8)
        if gate(hx):
            counts[hx] += 1
    return counts.most_common(1)[0][0] if counts and counts.most_common(1)[0][1] >= 40 else None


def brand_palette(domain, html=None, logo_bytes=None):
    tried = []
    try:
        if html is None:
            body, final = _get(f"https://{domain}/")
            html = body.decode("utf-8", "ignore")
        else:
            final = f"https://{domain}/"
    except Exception as e:
        tried.append(f"homepage failed ({type(e).__name__})")
        html, final = "", f"https://{domain}/"
    css = " ".join(re.findall(r"<style[^>]*>(.*?)</style>", html, re.S | re.I))
    for href in re.findall(r'<link[^>]+rel=["\']?stylesheet["\']?[^>]*href=["\']([^"\']+)', html, re.I)[:4]:
        try:
            css += " " + _get(urllib.parse.urljoin(final, href), limit=800_000)[0].decode("utf-8", "ignore")
        except Exception:
            pass

    cands = []
    for m in re.finditer(r'<meta[^>]+name=["\'](?:theme-color|msapplication-TileColor)["\'][^>]*content=["\']([^"\']+)', html, re.I):
        cands.append(("theme_color", _hex(m.group(1))))
    if logo_bytes is None:
        try:
            sys.path.insert(0, __file__.rsplit("/", 1)[0])
            from fetch_logo import fetch_logo
            lg = fetch_logo(domain, html=html or None, final_url=final)
            logo_bytes = lg.get("bytes") if lg.get("ok") else None
        except Exception:
            logo_bytes = None
    if logo_bytes:
        cands.append(("logo", _logo_colour(logo_bytes)))
    for m in BRAND_VAR.finditer(css):
        cands.append(("css_brand_variable", _hex(m.group(1))))
    freq = Counter(h for h in (_hex(v) for v in re.findall(r"#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|rgba?\([^)]*\)", css)) if h and gate(h))
    if freq and freq.most_common(1)[0][1] >= 5:
        cands.append(("css_most_used", freq.most_common(1)[0][0]))

    for source, h in cands:
        g = gate(h)
        tried.append(f"{source}:{h}{'' if g else ' (failed gate)'}")
        if g:
            _, l, _ = colorsys.rgb_to_hls(*_rgb(g))
            return {"accent": g, "accent2": _shade(g, min(0.62, l + 0.12)), "tag": _shade(g, 0.96, 0.6),
                    "source": source, "picked": h, "tried": tried}
    return dict(DEFAULT, tried=tried, reason="no colour passed the gate")


if __name__ == "__main__":
    print(brand_palette(sys.argv[1]))
