"""Serve the game from web/ for local testing, with caching switched off.

Python's plain http.server lets the browser keep old copies of the JavaScript files, so
after an edit the page can mix old and new files and stop working. This server tells the
browser to fetch every file fresh.

Run:  python3 tools/serve.py        then open http://localhost:8000
      python3 tools/serve.py 8080   to use another port
"""

import functools
import http.server
import pathlib
import sys

WEB = pathlib.Path(__file__).resolve().parent.parent / "web"


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    handler = functools.partial(NoCacheHandler, directory=str(WEB))
    with http.server.ThreadingHTTPServer(("", port), handler) as server:
        print(f"Serving {WEB} at http://localhost:{port} (no caching). Stop with Ctrl+C.")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
