"""mitmproxy addon for evaluation runs: refuse any request that names a benchmark source.

The proxy sees the request after TLS, so it does not matter how the client assembled the URL (shell variables,
percent-encoding, a child process, another HTTP client). The decoded host, Host header, path and the first 64 KB
of the body are matched against MI_EGRESS_DENY; a match is answered 403 and never sent upstream.
"""
import json
import os
import re
import time
from urllib.parse import unquote

from mitmproxy import http

DENY = re.compile(os.environ["MI_EGRESS_DENY"], re.I)


def decoded(s: str) -> str:
    for _ in range(3):
        s = unquote(s)
    return s


def request(flow: http.HTTPFlow) -> None:
    r = flow.request
    body = (r.get_content(strict=False) or b"")[:65536].decode("latin1")
    text = "\n".join(decoded(x) for x in (r.pretty_host, r.host_header or "", r.host, r.path, body))
    blocked = bool(DENY.search(text))
    print(json.dumps({"t": round(time.time(), 3), "host": r.pretty_host, "method": r.method,
                      "path": r.path[:300], "action": "blocked" if blocked else "allowed"}), flush=True)
    if blocked:
        flow.response = http.Response.make(403, b"blocked by the evaluation egress policy\n", {"Content-Type": "text/plain"})
