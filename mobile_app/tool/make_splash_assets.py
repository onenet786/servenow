"""Cuts the splash artwork out of images/servenow_brand_logo.png.

The logo is a wide picture (round badge beside the name) on a cream background,
so the parts are cut out and given transparent backgrounds for the tall splash:

  assets/splash/badge.png     the round cart badge
  assets/splash/wordmark.png  "ServeNow"
  assets/splash/tagline.png   the line under the name
  android/.../drawable-xxhdpi/splash_badge_native.png
      the badge for Android's own launch screen: a 288dp square with the badge
      filling the middle 192dp, the size and shape Android 12+ expects.

Run from mobile_app/: python tool/make_splash_assets.py
"""

import os

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOGO = os.path.join(ROOT, '..', 'images', 'servenow_brand_logo.png')
OUT = os.path.join(ROOT, 'assets', 'splash')
NATIVE = os.path.join(ROOT, 'android', 'app', 'src', 'main', 'res', 'drawable-xxhdpi')

BADGE_CENTRE = (422, 395)
BADGE_RADIUS = 233
WORDMARK_BOX = (672, 318, 1100, 396)
TAGLINE_BOX = (672, 408, 1232, 446)


def badge(logo, size):
    scale = 4
    x, y = BADGE_CENTRE
    r = BADGE_RADIUS
    crop = logo.crop((x - r, y - r, x + r, y + r)).resize((size, size), Image.LANCZOS)
    mask = Image.new('L', (size * scale, size * scale), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size * scale - 1, size * scale - 1), fill=255)
    crop.putalpha(mask.resize((size, size), Image.LANCZOS))
    return crop


def ink(logo, box, colour, upscale):
    """Keeps the dark lettering as one flat colour, so its edges stay clean on any background."""
    crop = logo.crop(box).convert('L')
    crop = crop.resize((crop.width * upscale, crop.height * upscale), Image.LANCZOS)
    darkest, paper = crop.getextrema()
    solid = darkest + (paper - darkest) * 0.35
    alpha = crop.point(lambda v: min(255, max(0, int((paper - 30 - v) * 255 / (paper - 30 - solid)))))
    bounds = alpha.point(lambda v: 255 if v > 40 else 0).getbbox()
    alpha = alpha.crop((bounds[0] - 4, bounds[1] - 4, bounds[2] + 4, bounds[3] + 4))
    out = Image.new('RGBA', alpha.size, colour + (0,))
    out.putalpha(alpha)
    return out


def main():
    logo = Image.open(LOGO).convert('RGB')
    os.makedirs(OUT, exist_ok=True)
    badge(logo, 840).save(os.path.join(OUT, 'badge.png'), optimize=True)
    ink(logo, WORDMARK_BOX, (0x58, 0x2B, 0x15), 3).save(os.path.join(OUT, 'wordmark.png'), optimize=True)
    ink(logo, TAGLINE_BOX, (0x6B, 0x3A, 0x22), 3).save(os.path.join(OUT, 'tagline.png'), optimize=True)

    native = Image.new('RGBA', (864, 864), (0, 0, 0, 0))
    disc = badge(logo, 576)
    native.paste(disc, (144, 144), disc)
    native.save(os.path.join(NATIVE, 'splash_badge_native.png'), optimize=True)


if __name__ == '__main__':
    main()
