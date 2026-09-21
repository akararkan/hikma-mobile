#!/usr/bin/env python3
"""Every brand raster, generated from the one master path.

    python3 scripts/brand-assets.py

WHY THIS IS NOT A ONE-LINER. There is no SVG rasteriser on this machine —
no rsvg, no Inkscape, no sharp — only macOS Quick Look, and Quick Look
FLATTENS ALPHA: ask it for a transparent PNG and you get an opaque white
square. A splash mark that is white-on-white, and an Android adaptive
foreground that hides its own background layer, both of which look fine in
the file listing and wrong on the phone.

So the mark is rendered as COVERAGE instead: black on white, which Quick Look
does perfectly, anti-aliasing included. Pillow then reads that back as
`alpha = 255 - grey` and paints it in whatever colour the output wants. One
render, exact edges, real transparency, and the opaque outputs are written
without an alpha channel at all — which is also what the App Store demands of
an icon.

THE INK BOX, NOT THE DOCUMENT BOX. The glyph is tall and narrow (ink
207 x 458 inside a 390 x 530 viewBox), so centring the document would sit it
visibly low and left. Every canvas below is composed around the measured ink.
"""
import io
import os
import re
import shutil
import subprocess
import sys
import tempfile

from PIL import Image

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MASTER = os.path.join(REPO, 'assets/brand/hand-sign-logo.svg')
WEB = os.path.expanduser('~/Documents/ika')

NAVY = (0x13, 0x23, 0x3d)      # the mark, as the author drew it
WHITE = (0xff, 0xff, 0xff)
BLACK = (0x00, 0x00, 0x00)
OXFORD = (0x00, 0x21, 0x47)    # the splash ground, and the app's identity

# Measured once from the master's path data; asserted below so a redrawn logo
# cannot silently shift every asset off-centre.
INK = dict(x0=94.0, x1=301.0, y0=20.0, y1=478.0)


def path_and_ink():
    svg = io.open(MASTER, encoding='utf-8').read()
    d = re.search(r'\sd="([^"]+)"', svg).group(1)
    nums = [float(n) for n in re.findall(r'-?\d+(?:\.\d+)?', d)]
    xs, ys = nums[0::2], nums[1::2]
    ink = dict(x0=min(xs), x1=max(xs), y0=min(ys), y1=max(ys))
    for k in INK:
        if abs(ink[k] - INK[k]) > 1:
            print(f'  ! the master moved: ink {k} {INK[k]} -> {ink[k]}')
    return d, ink


def coverage(d, ink, size, height_fraction):
    """Render the mark black-on-white at `size`, return it as an alpha mask."""
    iw, ih = ink['x1'] - ink['x0'], ink['y1'] - ink['y0']
    s = (size * height_fraction) / ih
    tx = size / 2 - (ink['x0'] + iw / 2) * s
    ty = size / 2 - (ink['y0'] + ih / 2) * s
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" '
           f'viewBox="0 0 {size} {size}">'
           f'<rect width="{size}" height="{size}" fill="#ffffff"/>'
           f'<g transform="translate({tx:.3f},{ty:.3f}) scale({s:.6f})">'
           f'<path fill="#000000" d="{d}"/></g></svg>')

    tmp = tempfile.mkdtemp()
    try:
        src = os.path.join(tmp, 'mark.svg')
        io.open(src, 'w', encoding='utf-8').write(svg)
        out = os.path.join(tmp, 'out')
        os.makedirs(out)
        subprocess.run(['qlmanage', '-t', '-s', str(size), '-o', out, src],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
        made = [f for f in os.listdir(out) if f.endswith('.png')]
        if not made:
            sys.exit('qlmanage produced nothing — is Quick Look available?')
        grey = Image.open(os.path.join(out, made[0])).convert('L').resize((size, size), Image.LANCZOS)
        # Black ink on white paper: coverage is the inverse of brightness.
        return Image.eval(grey, lambda v: 255 - v)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def write(mask, colour, dest, ground=None):
    """`ground=None` -> RGBA with real transparency. A ground -> flat RGB, no
    alpha channel at all (the App Store rejects an icon that has one)."""
    size = mask.size[0]
    mark = Image.new('RGBA', (size, size), colour + (0,))
    mark.putalpha(mask)
    if ground is None:
        out, mode = mark, 'RGBA'
    else:
        base = Image.new('RGB', (size, size), ground)
        base.paste(mark, (0, 0), mark)
        out, mode = base, 'RGB'
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    out.save(dest, 'PNG', optimize=True)
    rel = dest.replace(REPO + '/', '').replace(os.path.expanduser('~/'), '~/')
    print(f'  ✓ {rel:54} {size}x{size} {mode}')


def main():
    d, ink = path_and_ink()
    A = lambda p: os.path.join(REPO, p)
    print('brand assets')

    # THE APP ICON IS THE REVERSE: the white mark on Oxford navy. It is the
    # author's own rule — light mark on dark ground — and on a home screen it
    # is the version that holds its own against a photograph wallpaper, where
    # a white tile simply dissolves. Opaque, no alpha channel (the App Store
    # rejects an icon that has one).
    write(coverage(d, ink, 1024, 0.62), WHITE, A('assets/images/icon.png'), ground=OXFORD)
    # Android adaptive foreground: the same white mark, transparent, kept well
    # inside the launcher's 66% safe zone or the mask bites the glyph. Its
    # ground is the navy set in app.json.
    write(coverage(d, ink, 1024, 0.44), WHITE, A('assets/images/android-icon-foreground.png'))
    # Themed icons: one colour on transparency; Android recolours it.
    write(coverage(d, ink, 1024, 0.46), BLACK, A('assets/images/android-icon-monochrome.png'))
    # Splash: the ground is Oxford navy in app.json, so the mark is WHITE.
    write(coverage(d, ink, 1024, 0.74), WHITE, A('assets/images/splash-icon.png'))
    # Web favicon — the same lockup, so a browser tab matches the home screen.
    write(coverage(d, ink, 256, 0.62), WHITE, A('assets/images/favicon.png'), ground=OXFORD)
    # The paper lockup, beside the masters, for anywhere that needs the mark on
    # a light ground (a letterhead, a light-mode share card).
    write(coverage(d, ink, 1024, 0.66), NAVY, A('assets/brand/icon-on-paper.png'), ground=WHITE)

    if os.path.isdir(WEB):
        print('web')
        # Filenames unchanged on purpose: index.html, the share card and any
        # saved link already point at them.
        write(coverage(d, ink, 512, 0.62), WHITE, os.path.join(WEB, 'public/ika-logo.png'), ground=OXFORD)
        brand = os.path.join(WEB, 'public/brand')
        os.makedirs(brand, exist_ok=True)
        for f in ('hand-sign-logo.svg', 'hand-sign-logo-white.svg'):
            shutil.copyfile(os.path.join(REPO, 'assets/brand', f), os.path.join(brand, f))
        print(f'  ✓ {"~/Documents/ika/public/brand/*.svg":54} masters')


if __name__ == '__main__':
    main()
