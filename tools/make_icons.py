"""Generate the Trebuchet app icons (PNG + SVG) from one set of shapes.

Usage:  python3 tools/make_icons.py      (requires Pillow)
The design is full-bleed with key art inside the central 80% so the same
image works as both a regular and a maskable PWA icon.
"""
import math
import os

from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), '..', 'icons')
S = 512

SKY_TOP, SKY_BOTTOM = (59, 91, 140), (240, 163, 94)
SUN = (255, 222, 140)
INK = (43, 26, 14)
ROCK = (125, 127, 132)
ROCK_EDGE = (47, 48, 52)
BANNER = (155, 34, 38)

PIVOT = (215, 262)
TIP_A = math.radians(-58)
TIP = (PIVOT[0] + 185 * math.cos(TIP_A), PIVOT[1] + 185 * math.sin(TIP_A))
TAIL = (PIVOT[0] - 58 * math.cos(TIP_A), PIVOT[1] - 58 * math.sin(TIP_A))
ROCK_C, ROCK_R = (372, 132), 27
TRAIL = []

LINES = [  # (x0, y0, x1, y1, width)
    (148, 392, PIVOT[0], PIVOT[1], 20),
    (282, 392, PIVOT[0], PIVOT[1], 20),
    (178, 338, 252, 338, 14),
    (TAIL[0], TAIL[1], TIP[0], TIP[1], 20),
    (TIP[0], TIP[1], ROCK_C[0] - 10, ROCK_C[1] + 22, 5),
]
RECTS = [  # (x0, y0, x1, y1)
    (112, 384, 318, 402),
    (TAIL[0] - 27, TAIL[1] + 18, TAIL[0] + 27, TAIL[1] + 66),
]
WHEELS = [(142, 410, 20), (288, 410, 20)]


def gradient(img):
    d = ImageDraw.Draw(img)
    h = img.height
    for y in range(h):
        t = y / (h - 1)
        c = tuple(int(a + (b - a) * t) for a, b in zip(SKY_TOP, SKY_BOTTOM))
        d.line([(0, y), (img.width, y)], fill=c)


def png(size, path):
    k = 4  # supersample for smooth edges
    img = Image.new('RGB', (S * k, S * k))
    gradient(img)
    d = ImageDraw.Draw(img)
    sc = lambda v: v * k
    d.ellipse([sc(300), sc(150), sc(460), sc(310)], fill=SUN)
    # hill
    d.ellipse([sc(-120), sc(400), sc(632), sc(700)], fill=INK)
    d.rectangle([0, sc(470), sc(S), sc(S)], fill=INK)
    for x0, y0, x1, y1, w in LINES:
        d.line([sc(x0), sc(y0), sc(x1), sc(y1)], fill=INK, width=sc(w))
        for x, y in ((x0, y0), (x1, y1)):
            r = w / 2
            d.ellipse([sc(x - r), sc(y - r), sc(x + r), sc(y + r)], fill=INK)
    d.line([sc(TAIL[0]), sc(TAIL[1]), sc(TAIL[0]), sc(TAIL[1] + 20)], fill=INK, width=sc(5))
    for x0, y0, x1, y1 in RECTS:
        d.rounded_rectangle([sc(x0), sc(y0), sc(x1), sc(y1)], radius=sc(5), fill=INK)
    for x, y, r in WHEELS:
        d.ellipse([sc(x - r), sc(y - r), sc(x + r), sc(y + r)], fill=INK)
    # banner on the frame
    d.line([sc(PIVOT[0]), sc(PIVOT[1] - 10), sc(PIVOT[0]), sc(PIVOT[1] - 78)], fill=INK, width=sc(5))
    d.polygon([(sc(PIVOT[0]), sc(PIVOT[1] - 78)), (sc(PIVOT[0] + 48), sc(PIVOT[1] - 70)),
               (sc(PIVOT[0] + 36), sc(PIVOT[1] - 58)), (sc(PIVOT[0] + 48), sc(PIVOT[1] - 46)),
               (sc(PIVOT[0]), sc(PIVOT[1] - 50))], fill=BANNER)
    for i, (x, y) in enumerate(TRAIL):
        r = 5 + i * 2
        d.ellipse([sc(x - r), sc(y - r), sc(x + r), sc(y + r)], fill=(255, 245, 225))
    x, y = ROCK_C
    d.ellipse([sc(x - ROCK_R - 4), sc(y - ROCK_R - 4), sc(x + ROCK_R + 4), sc(y + ROCK_R + 4)], fill=ROCK_EDGE)
    d.ellipse([sc(x - ROCK_R), sc(y - ROCK_R), sc(x + ROCK_R), sc(y + ROCK_R)], fill=ROCK)
    d.ellipse([sc(x - 14), sc(y - 16), sc(x - 2), sc(y - 6)], fill=(196, 197, 201))
    img.resize((size, size), Image.LANCZOS).save(path, optimize=True)


def svg(path):
    f = lambda v: f'{v:.1f}'
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}">',
        '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">'
        f'<stop offset="0" stop-color="rgb{SKY_TOP}"/><stop offset="1" stop-color="rgb{SKY_BOTTOM}"/></linearGradient></defs>',
        f'<rect width="{S}" height="{S}" rx="96" fill="url(#g)"/>',
        f'<circle cx="380" cy="230" r="80" fill="rgb{SUN}"/>',
        f'<path d="M0 470 Q256 330 512 470 V512 H0Z" fill="rgb{INK}"/>',
        f'<g stroke="rgb{INK}" stroke-linecap="round" fill="none">',
    ]
    for x0, y0, x1, y1, w in LINES:
        parts.append(f'<line x1="{f(x0)}" y1="{f(y0)}" x2="{f(x1)}" y2="{f(y1)}" stroke-width="{w}"/>')
    parts.append(f'<line x1="{f(PIVOT[0])}" y1="{f(PIVOT[1] - 10)}" x2="{f(PIVOT[0])}" y2="{f(PIVOT[1] - 78)}" stroke-width="5"/></g>')
    parts.append(f'<g fill="rgb{INK}">')
    for x0, y0, x1, y1 in RECTS:
        parts.append(f'<rect x="{f(x0)}" y="{f(y0)}" width="{f(x1 - x0)}" height="{f(y1 - y0)}" rx="5"/>')
    for x, y, r in WHEELS:
        parts.append(f'<circle cx="{x}" cy="{y}" r="{r}"/>')
    parts.append('</g>')
    px, py = PIVOT
    parts.append(f'<path d="M{px} {py - 78} L{px + 48} {py - 70} L{px + 36} {py - 58} L{px + 48} {py - 46} L{px} {py - 50}Z" fill="rgb{BANNER}"/>')
    for i, (x, y) in enumerate(TRAIL):
        parts.append(f'<circle cx="{f(x)}" cy="{f(y)}" r="{5 + i * 2}" fill="#fff5e1"/>')
    x, y = ROCK_C
    parts.append(f'<circle cx="{x}" cy="{y}" r="{ROCK_R + 2}" fill="rgb{ROCK}" stroke="rgb{ROCK_EDGE}" stroke-width="5"/>')
    parts.append(f'<ellipse cx="{x - 8}" cy="{y - 11}" rx="6" ry="5" fill="#c4c5c9"/>')
    parts.append('</svg>')
    with open(path, 'w') as fh:
        fh.write(''.join(parts) + '\n')


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    png(512, os.path.join(OUT, 'icon-512.png'))
    png(512, os.path.join(OUT, 'maskable-512.png'))
    png(192, os.path.join(OUT, 'icon-192.png'))
    png(180, os.path.join(OUT, 'apple-touch-icon.png'))
    svg(os.path.join(OUT, 'favicon.svg'))
    print('icons written to', os.path.abspath(OUT))
