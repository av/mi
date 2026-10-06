"""mitmproxy addon: the evaluation egress policy, applied to every HTTP(S) request the task container makes
during the agent phase (the shim sends all of them here; there is no direct path).

The proxy sees the request after TLS, so it does not matter how the client assembled it (shell variables,
encodings, a child process, another HTTP client). Three rules, each about a KIND of route:

1. names     a request may not name a benchmark source (MI_EGRESS_DENY) — in its host, path, query or body,
             percent-decoded, and in base64 tokens it carries.
2. targets   a request that carries another address (a relay, reader, cache or fetching API given a URL to fetch)
             is judged by that address as well: every URL or watched host found in the decoded request must pass
             the same rules. A relay cannot be asked for what the client may not ask for itself.
3. identity  on hosts that address repositories by opaque identity, only routes that carry the repository's
             name are allowed. For the GitHub API that is an allowlist of path shapes (/repos/<owner>/<repo>/...,
             /users/<login>, /orgs/<login>, /search, ...): /repositories/<id>, /user/<id>, /organizations/<id>,
             /graphql and gists are refused as a class, whatever the id. Replies of that API are checked too: one
             that names a benchmark source (a redirect, a search hit, repository metadata) is withheld.

Requests to the model API (MI_EGRESS_MODEL_HOSTS) carry the whole conversation, so rules 1 and 2 are applied to
their URL only; a body that asks the provider to browse or search the web for the model is refused.
Tunnels are refused: CONNECT inside a connection, raw TCP after TLS, and WebSockets.
"""
import base64
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
OPAQUE_HOSTS = re.compile(r"(^|\.)gist\.github(usercontent)?\.com$", re.I)
GITHUB_API = re.compile(r"(^|\.)api\.github\.com$", re.I)
NAME = r"(?!\d+(?:/|$))[^/]+"  # an owner, login or repository segment: present and not purely numeric
GITHUB_API_SHAPES = re.compile(
    rf"^/(?:|repos/{NAME}/{NAME}(?:/.*)?|users/{NAME}(?:/.*)?|orgs/{NAME}(?:/.*)?|search/.*|rate_limit|meta|zen|octocat"
    r"|versions|emojis|licenses(?:/.*)?|gitignore/.*|markdown(?:/raw)?)$")
URLISH = re.compile(r"https?:/{1,2}([^\s/\"'<>\\:]+)(?::\d+)?(/[^\s\"'<>\\]*)?", re.I)
HOSTED = re.compile(r"\b((?:[a-z0-9-]+\.)*(?:github\.com|githubusercontent\.com))(/[^\s\"'<>\\]*)?", re.I)
B64 = (re.compile(r"[A-Za-z0-9+/]{16,}={0,2}"), re.compile(r"[A-Za-z0-9_-]{16,}={0,2}"), re.compile(r"[A-Za-z0-9+]{16,}={0,2}"))
WEB_TOOLS = re.compile(r'"(plugins|web_search_options|web_search|tools)"\s*:\s*\[?\s*\{[^{}]*"(id|type)"\s*:\s*"(web|web_search[^"]*|browser[^"]*)"|"model"\s*:\s*"[^"]*:online"', re.I)


def decoded(s: str) -> str:
    for _ in range(3):
        s = unquote(s)
    return s


def expand(text: str) -> str:
    """The text plus whatever its base64-looking tokens decode to (one level)."""
    extra = []
    for tok in {t for rx in B64 for t in rx.findall(text)[:200]}:
        try:
            raw = base64.b64decode(tok.replace("-", "+").replace("_", "/") + "=" * (-len(tok) % 4))
            if raw.isascii():
                extra.append(decoded(raw.decode("ascii")))
        except Exception:
            pass
    return text + "\n" + "\n".join(extra) if extra else text


def target_verdict(host: str, path: str) -> str | None:
    """Reason to refuse an address (host + path, already decoded), or None."""
    host, path = host.lower().rstrip("."), path or "/"
    bare = re.sub(r"/{2,}", "/", path.split("?", 1)[0].split("#", 1)[0])
    norm = posixpath.normpath(bare) if bare.startswith("/") else bare  # /a/../b is /b: judge the route the server will see
    if DENY.search(host + path) or DENY.search(host + norm):
        return "names a benchmark source"
    if OPAQUE_HOSTS.search(host):
        return "opaque repository route (gist)"
    if GITHUB_API.search(host) and not (GITHUB_API_SHAPES.match(norm) and (bare.rstrip("/") or "/") == norm):
        return "GitHub API route without a repository name (opaque identity)"
    return None


def request_verdict(host: str, sni: str, path: str, body: str, model_api: bool) -> str | None:
    path_d = decoded(path)
    for h in {host, sni} - {""}:
        if why := target_verdict(h, path_d):
            return why
    if model_api:
        return "asks the model provider to browse the web" if WEB_TOOLS.search(body) else None
    text = expand(path_d + "\n" + decoded(body))
    if DENY.search(text):
        return "names a benchmark source"
    carried = path_d[1:] + "\n" + text.split("\n", 1)[1]  # the request's own path is a path, not a carried address
    for rx in (URLISH, HOSTED):
        for m in rx.finditer(carried):
            if why := target_verdict(m.group(1), decoded(m.group(2) or "/")):
                return f"carries a target that {why}" if not why.startswith("names") else why
    return None


def log(**kw):
    print(json.dumps({"t": round(time.time(), 3), **kw}), flush=True)


def refuse(flow, why: str, where: str = "request") -> None:
    r = flow.request
    log(host=r.pretty_host, method=r.method, path=r.path[:300], action="blocked", where=where, why=why)
    flow.response = http.Response.make(403, f"blocked by the evaluation egress policy ({why})\n".encode(), {"Content-Type": "text/plain"})


def request(flow) -> None:
    r = flow.request
    if r.method.upper() == "CONNECT":
        return refuse(flow, "tunnel inside a connection")
    host, sni = r.pretty_host or r.host, (flow.client_conn.sni or "")
    model_api = bool(MODEL_HOSTS.search(host)) and (not sni or bool(MODEL_HOSTS.search(sni)))
    body = (r.get_content(strict=False) or b"")[:262144].decode("latin1")
    if why := request_verdict(host, sni, r.path, body, model_api):
        return refuse(flow, why)
    log(host=host, method=r.method, path=r.path[:300], action="allowed")


def responseheaders(flow) -> None:
    r = flow.response
    loc = decoded(r.headers.get("location", ""))
    if loc and not MODEL_HOSTS.search(flow.request.pretty_host):
        m = URLISH.match(loc)
        why = target_verdict(m.group(1), m.group(2) or "/") if m else ("names a benchmark source" if DENY.search(loc) else None)
        if why:
            return refuse(flow, why, "redirect")
    ctype = r.headers.get("content-type", "")
    if "event-stream" in ctype or MODEL_HOSTS.search(flow.request.pretty_host):
        r.stream = True  # model replies are streamed through as they come


def response(flow) -> None:
    r = flow.response
    if r is None or r.stream or not GITHUB_API.search(flow.request.pretty_host):
        return
    body = (r.get_content(strict=False) or b"")[:1048576].decode("latin1")
    if DENY.search(decoded(body)):
        refuse(flow, "reply names a benchmark source", "response")


def tcp_start(flow) -> None:
    log(action="blocked", where="tcp", why="raw TCP inside a connection")
    flow.kill()


def websocket_start(flow) -> None:
    log(host=flow.request.pretty_host, action="blocked", where="websocket", why="WebSocket tunnel")
    flow.kill()
