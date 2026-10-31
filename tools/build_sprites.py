#!/usr/bin/env python3
"""Build the Fish guide's icon sheets from app/data/fish.json and app/icons/.

The guide shows every fish in a log at once, and as separate PNGs that's
about 12 MB for the Rod log. Packed into one lossy WebP sheet per log and
expansion it's under 2 MB for both logs, in about a dozen requests.

Writes app/icons/guide/<log>-<exp>.<hash>.webp and app/data/sprites.json:
  {"size": 80, "cols": 16, "sheets": [{"file": "icons/guide/…", "icons": [icon ids]}]}
An icon's slot is its index in "icons", left to right, top to bottom. The
hash in the name changes with the content, so the service worker (which
keeps anything under icons/ forever) never serves an old sheet.

Needs Pillow (the data build itself is stdlib only). Run after
build_data.py whenever fish.json or the icons change; the unit tests fail
if the sheets don't match fish.json.

Usage: python3 tools/build_sprites.py
"""
import hashlib
import io
import json
import math
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / 'app'
OUT_DIR = APP / 'icons' / 'guide'
MAP = APP / 'data' / 'sprites.json'
SIZE = 80  # the _hr1 fish icons' own size: no resampling
COLS = 16
QUALITY = 75  # indistinguishable from the PNGs at tile size, ~1/7 the bytes


def main():
    data = json.loads((APP / 'data' / 'fish.json').read_text())
    groups = {}
    for f in sorted(data['fish'].values(), key=lambda f: (f['log'], f['no'])):
        icons = groups.setdefault(f"{f['log']}-{f['exp']}", [])
        if f['icon'] not in icons:
            icons.append(f['icon'])

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    old = set(OUT_DIR.glob('*.webp'))
    sheets, total = [], 0
    for name, icons in sorted(groups.items()):
        rows = math.ceil(len(icons) / COLS)
        sheet = Image.new('RGBA', (COLS * SIZE, rows * SIZE))
        for i, icon in enumerate(icons):
            im = Image.open(APP / 'icons' / f'{icon}.png').convert('RGBA')
            if im.size != (SIZE, SIZE):
                im = im.resize((SIZE, SIZE), Image.LANCZOS)
            sheet.paste(im, ((i % COLS) * SIZE, (i // COLS) * SIZE))
        buf = io.BytesIO()
        sheet.save(buf, 'WEBP', quality=QUALITY, method=6)
        blob = buf.getvalue()
        path = OUT_DIR / f'{name}.{hashlib.sha256(blob).hexdigest()[:8]}.webp'
        path.write_bytes(blob)
        old.discard(path)
        total += len(blob)
        sheets.append({'file': path.relative_to(APP).as_posix(), 'icons': icons})
    for stale in old:
        stale.unlink()

    MAP.write_text(json.dumps({'size': SIZE, 'cols': COLS, 'sheets': sheets}, separators=(',', ':')) + '\n')
    print(f'{len(sheets)} sheets, {sum(len(s["icons"]) for s in sheets)} icons, {total // 1024} KB')
    return 0


if __name__ == '__main__':
    sys.exit(main())
