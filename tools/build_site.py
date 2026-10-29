#!/usr/bin/env python3
"""Build the deployable site in dist/ from app/.

Copies app/, then fills in sw.js: VERSION (a hash of every file the worker
precaches, so any change to the app or data triggers an update) and PRECACHE
(every file except icons, which are cached on demand).

Usage: python3 tools/build_site.py
"""
import hashlib
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / 'app'
DIST = ROOT / 'dist'
ON_DEMAND = ('icons/',)  # cached by the worker as they're viewed
SKIP = ('sw.js',)


def main():
    if DIST.exists():
        shutil.rmtree(DIST)
    shutil.copytree(APP, DIST)

    files = sorted(p.relative_to(DIST).as_posix() for p in DIST.rglob('*') if p.is_file())
    precache = [f for f in files if not f.startswith(ON_DEMAND) and f not in SKIP]
    h = hashlib.sha256()
    for f in precache:
        h.update(f.encode())
        h.update((DIST / f).read_bytes())
    version = h.hexdigest()[:12]

    sw = DIST / 'sw.js'
    src = sw.read_text()
    for placeholder in ('__VERSION__', '__PRECACHE__'):
        if placeholder not in src:
            print(f'sw.js is missing {placeholder}', file=sys.stderr)
            return 1
    sw.write_text(src.replace("'__VERSION__'", json.dumps(version))
                     .replace('__PRECACHE__', json.dumps(['./', *precache])))
    # Show the version in the app (Profile) so a device can be checked against
    # a deploy. Stamped after hashing; the hash covers the unstamped source.
    app_js = DIST / 'app.js'
    a = app_js.read_text()
    if "'__APP_VERSION__'" not in a:
        print('app.js is missing __APP_VERSION__', file=sys.stderr)
        return 1
    app_js.write_text(a.replace("'__APP_VERSION__'", json.dumps(version)))
    # Lets a deploy be checked against a commit.
    (DIST / 'version.txt').write_text(version + '\n')

    size = sum((DIST / f).stat().st_size for f in precache)
    print(f'dist/ built: version {version}, {len(precache)} precached files ({size // 1024} KB), '
          f'{len(files) - len(precache) - 1} icons on demand')
    return 0


if __name__ == '__main__':
    sys.exit(main())
