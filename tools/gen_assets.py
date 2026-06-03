#!/usr/bin/env python3
"""
Generate Pebble appstore assets for Murmur.

Outputs into ../store/:
  icon-large-144.png     large appstore icon (144x144)
  icon-small-48.png      small appstore icon (48x48)
  menu-icon-25.png       in-app/launcher menu icon, white on transparent (25x25)
  banner-720x320.png     marketing banner

Re-run after tweaking the palette/glyph:  python3 tools/gen_assets.py
The drawn microphone mirrors the C app's home glyph so the brand is consistent.
"""

import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "store")
os.makedirs(OUT, exist_ok=True)

BG = (0, 0, 0, 255)
CYAN = (0, 170, 255, 255)        # ~ GColorVividCerulean
WHITE = (255, 255, 255, 255)
GREY = (170, 170, 170, 255)


def draw_mic(d, cx, cy, h, color, stroke):
    """Draw a microphone centred on (cx, cy) with overall height ~h."""
    u = h / 100.0  # unit scale
    # Capsule (mic head)
    cw, ch = 36 * u, 50 * u
    top = cy - 42 * u
    d.rounded_rectangle([cx - cw / 2, top, cx + cw / 2, top + ch],
                        radius=cw / 2, fill=color)
    # Cradle: a U arc hugging the capsule's lower half
    cr = 32 * u
    ccy = cy - 6 * u
    d.arc([cx - cr, ccy - cr, cx + cr, ccy + cr],
          start=20, end=160, fill=color, width=max(2, int(stroke)))
    # Stem
    sw = 8 * u
    d.rounded_rectangle([cx - sw / 2, ccy + cr - 2 * u, cx + sw / 2, cy + 32 * u],
                        radius=sw / 4, fill=color)
    # Base
    bw = 46 * u
    d.rounded_rectangle([cx - bw / 2, cy + 30 * u, cx + bw / 2, cy + 40 * u],
                        radius=4 * u, fill=color)


def rings(d, cx, cy, radii, color, width):
    for r in radii:
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=color, width=width)


def load_font(size):
    for name in ("DejaVuSans-Bold.ttf", "Arial Bold.ttf", "Arial.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def make_icon(size, fname, bg, color, border=False):
    img = Image.new("RGBA", (size, size), bg)
    d = ImageDraw.Draw(img)
    if border:
        d.rounded_rectangle([1, 1, size - 2, size - 2],
                            radius=size // 8, outline=CYAN, width=max(1, size // 48))
    draw_mic(d, size / 2, size / 2, h=size * 0.62, color=color,
             stroke=max(2, size / 24))
    img.save(os.path.join(OUT, fname))
    print("wrote", fname, img.size)


def make_menu_icon(size, fname):
    # Two-tone so it stays visible in BOTH launcher row states. Colour platforms
    # (emery/gabbro) render menu icons as non-inverting greyscale, so a single
    # tone vanishes on one background. A dark opaque tile (shows on the light
    # unselected row) plus a white mic (shows on the dark selected row) reads on
    # both.
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=size // 5, fill=(0, 0, 0, 255))
    draw_mic(d, size / 2, size / 2, h=size * 0.66, color=WHITE, stroke=2)
    img.save(os.path.join(OUT, fname))
    print("wrote", fname, img.size)


def fit_font(d, text, max_width, start_size, min_size=12):
    size = start_size
    while size > min_size:
        f = load_font(size)
        if d.textlength(text, font=f) <= max_width:
            return f
        size -= 2
    return load_font(min_size)


def make_banner(fname):
    w, h = 720, 320
    img = Image.new("RGBA", (w, h), BG)
    d = ImageDraw.Draw(img)
    mic_cx, mic_cy = 150, h // 2
    # Faint sonar rings behind the mic.
    faint = (0, 170, 255, 70)
    rings(d, mic_cx, mic_cy, [62, 90, 118], faint, 3)
    draw_mic(d, mic_cx, mic_cy, h=140, color=CYAN, stroke=6)

    text_x = 312
    avail = w - text_x - 28
    title = "Murmur"
    tagline = "Voice AI, on your wrist."
    title_font = fit_font(d, title, avail, 84)
    tag_font = fit_font(d, tagline, avail, 30)
    d.text((text_x, 112), title, font=title_font, fill=WHITE)
    d.text((text_x + 3, 200), tagline, font=tag_font, fill=GREY)
    img.convert("RGB").save(os.path.join(OUT, fname))
    print("wrote", fname, (w, h))


if __name__ == "__main__":
    make_icon(144, "icon-large-144.png", BG, CYAN, border=True)
    make_icon(48, "icon-small-48.png", BG, CYAN, border=True)
    make_menu_icon(25, "menu-icon-25.png")
    make_banner("banner-720x320.png")
    print("done ->", os.path.normpath(OUT))
