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
4. a request to the model API (MI_EGRESS_MODEL_HOSTS) may not ask the provider to search or fetch for the model.
   Its whole body is read (never streamed past this filter) and parsed as JSON; a body that is not one JSON object
   or cannot be judged is refused. Refused in the object, in every value of a repeated key: a `model` or `models` entry with the
   `:online` suffix, `web_search_options` or `web_search`, a `plugins` entry with id `web` (or one whose id cannot
   be read), a `tools` entry whose type is not `function` (those run at the provider: web search, web fetch), and
   a non-text content part of `messages` or `input` that carries an http(s) URL (a file or image the provider
   would download).
5. tunnels are refused: CONNECT inside a connection, raw TCP after TLS, WebSockets.

What is NOT enforced: request headers and bodies are not inspected (apart from rule 4), so the policy rests on
the allowlist containing no host that fetches arbitrary URLs for its caller. A copy of benchmark material under
an unrelated name on an allowed host (a renamed fork, a dataset upload) is not recognised. Rule 4 knows the
request fields listed there and no others: search switched on outside the request (an account default or preset
at the provider), a model that searches by itself, or a field of another provider's API is not recognised.
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


class Obj(list):
    """A JSON object as its (key, value) pairs: a repeated key keeps every value, servers differ in which they read."""


def values(obj, key: str) -> list:
    return [v for k, v in obj if k.lower() == key] if isinstance(obj, Obj) else []


def strings(node, skip: str = ""):
    """Every string value under a parsed JSON node, except those under the key `skip`."""
    if isinstance(node, str):
        yield node
    elif isinstance(node, Obj):
        for k, v in node:
            if k.lower() != skip:
                yield from strings(v, skip)
    elif isinstance(node, list):
        for v in node:
            yield from strings(v, skip)


def entries(value) -> list:
    """The items of a JSON array; anything else that is not null counts as one entry."""
    return value if type(value) is list else [] if value is None else [value]


def web_request(body: str | bytes) -> str | None:
    """Reason to refuse a model API request body (rule 4), or None. The body is judged as the JSON a server parses,
    not as text: escapes, key order, entry order and repeated keys make no difference."""
    if not body or not body.strip():
        return None
    try:
        doc = json.loads(body, object_pairs_hook=Obj)
    except Exception:  # not UTF-8/16/32, not JSON, nested too deep
        return "model API request body is not JSON"
    if not isinstance(doc, Obj):
        return "model API request body is not a JSON object"
    try:
        return web_fields(doc)
    except Exception:  # e.g. nested too deep to walk
        return "model API request body could not be judged"


def web_fields(doc: Obj) -> str | None:
    why = "asks the model provider to browse the web"
    models = values(doc, "model") + [m for ms in values(doc, "models") for m in entries(ms)]
    if any(isinstance(m, str) and ":online" in m.lower() for m in models):
        return why
    if any(v is not None for key in ("web_search_options", "web_search") for v in values(doc, key)):
        return why
    for plugins in values(doc, "plugins"):
        for plugin in entries(plugins):
            ids = values(plugin, "id")
            if not ids or any(not isinstance(i, str) or i.strip().lower() == "web" for i in ids):
                return why
    for tools in values(doc, "tools"):
        for tool in entries(tools):
            if not (types := values(tool, "type")) or any(t != "function" for t in types):
                return "names a tool that runs at the model provider"
    for key in ("messages", "input"):
        for messages in values(doc, key):
            for message in entries(messages):
                for content in values(message, "content"):
                    for part in content if type(content) is list else []:
                        if any(re.match(r"\s*https?://", s, re.I) for s in strings(part, "text")):
                            return "asks the model provider to fetch a URL"
    return None


def request_verdict(connect_host: str, host_header: str, sni: str, path: str, body: str | bytes = "") -> str | None:
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
    if MODEL_HOSTS.search(host):
        return web_request(body)
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
    try:
        body = (r.get_content(strict=False) or b"") if MODEL_HOSTS.search(canon(r.host)) else b""
        why = request_verdict(r.host, r.host_header or "", flow.client_conn.sni or "", r.path, body)
    except Exception as e:  # mitmproxy forwards a request whose hook raised: a request that cannot be judged is refused
        why = f"the policy could not judge the request ({type(e).__name__})"
    if why:
        return refuse(flow, why)
    log(host=canon(r.host), method=r.method, path=r.path[:300], action="allowed")


def running() -> None:
    from mitmproxy import ctx
    # with this option set, mitmproxy forwards a request body over the limit before request() has seen it
    ctx.options.stream_large_bodies = None


def responseheaders(flow) -> None:
    if canon(flow.request.host) != "api.github.com":
        flow.response.stream = True  # replies are passed through as they come; only api.github.com's are read (response())


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
