"""mitmproxy addon: the evaluation egress policy. During the agent phase every HTTP(S) request of the task
container arrives here (the shim sends all of them; nothing else leaves the container).

What is enforced, in this order:

1. host allowlist (default deny). The request's host must be on allowlist.txt, and the name the connection was
   opened for, the TLS server name and the Host header must all be that same name. A request to any other host
   — including an address literal, a relay, reader, cache or mirror on a host that is not listed — is answered
   403 and never sent. The proxy connects to the named host itself, so a client cannot attach an allowed name to
   another machine's address.
2. on the allowed hosts, a request may not name a benchmark source (MI_EGRESS_DENY) in its host or
   percent-decoded path and query.
3. GitHub is allowed for named repositories only: github.com/<owner>/<repo>/..., raw.githubusercontent.com and
   codeload.github.com/<owner>/<repo>/..., api.github.com/repos/<owner>/<repo>/... . Every other GitHub route is
   refused: routes by numeric id, /graphql, search, organisation and user listings, gists. The benchmark's own
   organisations are refused by rule 2. Replies of api.github.com that name a benchmark source are withheld.
4. the model API (MI_EGRESS_MODEL_HOSTS) may not be asked to browse or search the web for the model.
5. tunnels are refused: CONNECT inside a connection, raw TCP after TLS, WebSockets.

What is NOT enforced: request headers and bodies are not inspected (apart from rule 4), so the policy rests on
the allowlist containing no host that fetches arbitrary URLs for its caller. A copy of benchmark material under
an unrelated name on an allowed host (a renamed fork, a dataset upload) is not recognised.
"""
import ipaddress
import json
import os
import posixpath
import re
import time
from urllib.parse import unquote

try:
    from mitmproxy import http
except ImportError:  # the policy functions are importable (and unit-tested) without mitmproxy
    http = None

DENY = re.compile(os.environ["MI_EGRESS_DENY"], re.I)
MODEL_HOSTS = re.compile(os.environ.get("MI_EGRESS_MODEL_HOSTS") or r"(?!)", re.I)
ALLOWLIST = os.environ.get("MI_EGRESS_ALLOWLIST", os.path.join(os.path.dirname(os.path.abspath(__file__)), "allowlist.txt"))
NAME = r"(?!\d+(?:/|$))[A-Za-z0-9][A-Za-z0-9._-]*"  # an owner or repository name: not purely numeric
NOT_OWNERS = ("orgs|organizations|users|user|search|topics|explore|trending|collections|marketplace|sponsors|settings|login|logout|join|"
              "signup|sessions|enterprises|enterprise|apps|features|notifications|pulls|issues|codespaces|gist|gists|repositories|"
              "new|about|site|security|customer-stories|readme|events|dashboard|stars|watching")
GITHUB_ROUTES = {
    "github.com": re.compile(rf"^/(?!(?:{NOT_OWNERS})/){NAME}/{NAME}(?:/.*)?$", re.I),
    "raw.githubusercontent.com": re.compile(rf"^/{NAME}/{NAME}/.+$"),
    "codeload.github.com": re.compile(rf"^/{NAME}/{NAME}/.+$"),
    "api.github.com": re.compile(rf"^/repos/{NAME}/{NAME}(?:/.*)?$"),
}
WEB_TOOLS = re.compile(r'"(plugins|web_search_options|web_search|tools)"\s*:\s*\[?\s*\{[^{}]*"(id|type)"\s*:\s*"(web|web_search[^"]*|browser[^"]*)"|"model"\s*:\s*"[^"]*:online"', re.I)


def load_allowlist(path: str) -> tuple[set[str], tuple[str, ...]]:
    exact, suffixes = set(), []
    for line in open(path):
        name = line.split("#", 1)[0].strip().lower()
        if name:
            (suffixes.append(name) if name.startswith(".") else exact.add(name))
    return exact, tuple(suffixes)


EXACT, SUFFIXES = load_allowlist(ALLOWLIST)


def canon(host: str) -> str:
    return (host or "").strip().lower().rstrip(".")


def host_allowed(host: str) -> bool:
    return host in EXACT or any(host.endswith(s) for s in SUFFIXES)


def decoded(s: str) -> str:
    for _ in range(3):
        s = unquote(s)
    return s


def request_verdict(connect_host: str, host_header: str, sni: str, path: str, body: str = "") -> str | None:
    """Reason to refuse a request, or None. connect_host: the name the connection was opened for."""
    host = canon(connect_host)
    try:
        ipaddress.ip_address(host.strip("[]"))
        return "the destination is an address, not a listed host name"
    except ValueError:
        pass
    for other in (canon(host_header).rsplit(":", 1)[0] if host_header else "", canon(sni)):
        if other and other != host:
            return "the connection, TLS and Host names disagree"
    if not host_allowed(host):
        return "host is not on the allowlist"
    path_d = decoded(path or "/")
    bare = re.sub(r"/{2,}", "/", path_d.split("?", 1)[0].split("#", 1)[0])
    norm = posixpath.normpath(bare) if bare.startswith("/") else bare  # /a/../b is /b: judge the route the server sees
    if DENY.search(host + path_d) or DENY.search(host + norm):
        return "names a benchmark source"
    if (route := GITHUB_ROUTES.get(host)) and not (route.match(norm) and (bare.rstrip("/") or "/") == norm):
        return "GitHub route that is not a named repository"
    if MODEL_HOSTS.search(host) and WEB_TOOLS.search(body):
        return "asks the model provider to browse the web"
    return None


def log(**kw):
    print(json.dumps({"t": round(time.time(), 3), **kw}), flush=True)


def refuse(flow, why: str, where: str = "request") -> None:
    r = flow.request
    log(host=canon(r.host), method=r.method, path=r.path[:300], action="blocked", where=where, why=why)
    flow.response = http.Response.make(403, f"blocked by the evaluation egress policy ({why})\n".encode(), {"Content-Type": "text/plain"})


def request(flow) -> None:
    r = flow.request
    if r.method.upper() == "CONNECT":
        return refuse(flow, "tunnel inside a connection")
    body = (r.get_content(strict=False) or b"")[:262144].decode("latin1") if MODEL_HOSTS.search(canon(r.host)) else ""
    if why := request_verdict(r.host, r.host_header or "", flow.client_conn.sni or "", r.path, body):
        return refuse(flow, why)
    log(host=canon(r.host), method=r.method, path=r.path[:300], action="allowed")


def responseheaders(flow) -> None:
    r = flow.response
    if "event-stream" in r.headers.get("content-type", "") or MODEL_HOSTS.search(canon(flow.request.host)):
        r.stream = True  # model replies are streamed through as they come


def response(flow) -> None:
    r = flow.response
    if r is None or r.stream or canon(flow.request.host) != "api.github.com":
        return
    body = (r.get_content(strict=False) or b"")[:1048576].decode("latin1")
    if DENY.search(decoded(body)):
        refuse(flow, "reply names a benchmark source", "response")


def tcp_start(flow) -> None:
    log(action="blocked", where="tcp", why="raw TCP inside a connection")
    flow.kill()


def websocket_start(flow) -> None:
    log(host=canon(flow.request.host), action="blocked", where="websocket", why="WebSocket tunnel")
    flow.kill()
