"""Synthetic relay for the egress probe: a stand-in for readers, caches and fetching services on hosts the policy
does not know. It fetches ONLY from the synthetic fixture (http://mi-fixture/...) and understands the usual ways
such services take their target: in the path, in a ?url= parameter, base64 in the path, and in a POST body."""
import base64
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, unquote, urlsplit
from urllib.request import urlopen


class Relay(BaseHTTPRequestHandler):
    def fetch(self, target: str):
        target = unquote(target)
        if not target.startswith("http://mi-fixture/"):
            return self.send_error(404)
        body = urlopen(target, timeout=10).read()
        self.send_response(200)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urlsplit(self.path)
        if u.path.startswith("/b64/"):
            return self.fetch(base64.urlsafe_b64decode(u.path[5:] + "=" * (-len(u.path[5:]) % 4)).decode())
        if "url" in (q := parse_qs(u.query)):
            return self.fetch(q["url"][0])
        self.fetch(self.path[1:])

    def do_POST(self):
        self.fetch(self.rfile.read(int(self.headers.get("content-length", 0))).decode())

    def log_message(self, *a):
        pass


HTTPServer(("0.0.0.0", 80), Relay).serve_forever()
