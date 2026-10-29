#!/usr/bin/env python3
"""Static server that sends GitHub Pages' caching header (max-age=600), so
the PWA test sees the same HTTP caching as production.

Usage: python3 tests/serve_pages.py PORT DIR
"""
import functools
import http.server
import sys


class PagesHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'max-age=600')
        super().end_headers()

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    port, root = int(sys.argv[1]), sys.argv[2]
    handler = functools.partial(PagesHandler, directory=root)
    http.server.ThreadingHTTPServer(('127.0.0.1', port), handler).serve_forever()
