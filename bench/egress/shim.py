#!/usr/bin/env python3
"""Transparent egress shim for evaluation runs (runs in the sidecar whose network namespace the task container shares).

Every outbound IPv4 TCP connection of the task container is redirected here by nftables (the task container has
neither NET_ADMIN nor NET_RAW and cannot change that). While the agent phase runs, the shim reads the first bytes
of each connection and decides:

  via-proxy  the connection speaks HTTP or TLS and names a host (TLS server name, HTTP Host header, CONNECT
             target). The shim asks the filtering proxy (filter.py) to open a connection to THAT NAME — not to the
             address the client dialled — and relays the bytes. The proxy applies the host allowlist and the other
             rules documented in filter.py.
  refused    everything else: connections that are not HTTP or TLS (ssh, raw TCP, server-speaks-first protocols)
             and HTTP or TLS connections that name no host. They do not leave the container.
  direct     connections to the proxy itself (a client using it explicitly; it is filtered there), and
             destinations listed in MI_EGRESS_ALLOW_RAW ("host:port ..."), which is empty by default.

Also enforced by the nftables rules below: IPv6 is rejected, and so is every UDP port except 53.
Not inspected: DNS (UDP 53 and the container's local resolver).

/run/mi-egress/passthrough (created from the host when the agent phase is over) turns the shim into a plain
relay: during verification nothing is filtered, so the verifier's own downloads work.
"""
import asyncio
import ipaddress
import json
import os
import re
import socket
import struct
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT, CA_PORT, MARK = 12345, 12346, 0x1BD5
PROXY = os.environ.get("MI_EGRESS_PROXY", "mi-egress-proxy:8080").rsplit(":", 1)
ALLOW_RAW = set(os.environ.get("MI_EGRESS_ALLOW_RAW", "").split())
proxy_ips: set[str] = set()
PASS_FLAG, READY = "/run/mi-egress/passthrough", "/run/mi-egress/ready"

NFT = f"""
table inet mi_egress {{
  chain nat_out {{
    type nat hook output priority -100;
    meta mark {MARK} return
    ip daddr 127.0.0.0/8 return
    ip6 daddr ::1 return
    meta nfproto ipv4 meta l4proto tcp redirect to :{PORT}
  }}
  chain filter_out {{
    type filter hook output priority 0;
    meta mark {MARK} accept
    ip daddr 127.0.0.0/8 accept
    udp dport != 53 reject
    ip6 daddr != ::1 reject
  }}
}}
"""


def log(**kw):
    print(json.dumps({"t": round(time.time(), 3), **kw}), flush=True)


def refresh_proxy():
    while True:
        try:
            proxy_ips.update(a[4][0] for a in socket.getaddrinfo(PROXY[0], None))
        except OSError:
            pass
        time.sleep(30)


def original_dst(sock) -> tuple[str, int]:
    raw = sock.getsockopt(socket.SOL_IP, 80, 16)  # SO_ORIGINAL_DST
    return socket.inet_ntoa(raw[4:8]), struct.unpack("!H", raw[2:4])[0]


def sniff(data: bytes) -> tuple[str, str]:
    """(kind, name): kind is "tls", "http" or "" (neither); name is the TLS SNI, the HTTP Host header or the
    CONNECT target ('' when the client sent none)."""
    if len(data) > 5 and data[0] == 0x16 and data[1] == 3:
        try:
            p = 5 + 4 + 2 + 32  # record header, handshake header, version, random
            p += 1 + data[p]  # session id
            p += 2 + struct.unpack("!H", data[p:p + 2])[0]  # cipher suites
            p += 1 + data[p]  # compression
            end = p + 2 + struct.unpack("!H", data[p:p + 2])[0]
            p += 2
            while p + 4 <= min(end, len(data)):
                typ, ln = struct.unpack("!HH", data[p:p + 4])
                if typ == 0:
                    return "tls", data[p + 9:p + 9 + struct.unpack("!H", data[p + 7:p + 9])[0]].decode("ascii", "replace").lower()
                p += 4 + ln
        except (IndexError, struct.error):
            pass
        return "tls", ""
    head = data.split(b"\r\n\r\n", 1)[0].decode("latin1")
    if m := re.match(r"CONNECT\s+\[?([^\s\]]+?)\]?:\d+\s", head, re.I):
        return "http", m.group(1).lower()
    if re.match(r"[A-Z]+ \S+ HTTP/1\.[01]\r?\n", head):
        m = re.search(r"^host:\s*\[?([^\s\]:]+)", head, re.I | re.M)
        return "http", m.group(1).lower() if m else ""
    return "", ""


def decide(kind: str, host: str, ip: str, port: int, passthrough: bool) -> str:
    if passthrough:
        return "direct"
    if ip in proxy_ips and port == int(PROXY[1]):
        return "direct"  # the filtering proxy itself: whatever is sent to it is filtered there
    if f"{ip}:{port}" in ALLOW_RAW or (host and f"{host}:{port}" in ALLOW_RAW):
        return "direct"
    if kind in ("tls", "http") and host:
        return "via-proxy"
    return "refused"  # not HTTP/TLS, or no host name: nothing the proxy could check


async def open_marked(host: str, port: int):
    loop = asyncio.get_running_loop()
    last = None
    for fam, typ, proto, _, addr in await loop.getaddrinfo(host, port, type=socket.SOCK_STREAM):
        s = socket.socket(fam, typ, proto)
        s.setsockopt(socket.SOL_SOCKET, socket.SO_MARK, MARK)
        s.setblocking(False)
        try:
            await asyncio.wait_for(loop.sock_connect(s, addr), 20)
            return await asyncio.open_connection(sock=s)
        except (OSError, asyncio.TimeoutError) as e:
            last = e
            s.close()
    raise last or OSError("no address")


async def pipe(r, w):
    try:
        while data := await r.read(65536):
            w.write(data)
            await w.drain()
    except (OSError, asyncio.IncompleteReadError):
        pass
    finally:
        try:
            w.close()
        except OSError:
            pass


async def handle(reader, writer):
    sock = writer.get_extra_info("socket")
    try:
        ip, port = original_dst(sock)
    except OSError:
        writer.close()
        return
    if port == PORT and ipaddress.ip_address(ip).is_loopback:  # someone connected to the shim itself
        writer.close()
        return
    try:
        first = await asyncio.wait_for(reader.read(8192), 3)
    except asyncio.TimeoutError:
        first = b""  # server-speaks-first protocol (ssh, smtp): no name to read
    kind, host = sniff(first)
    action = decide(kind, host, ip, port, os.path.exists(PASS_FLAG))
    if action == "refused":
        log(dst=ip, port=port, host=host, kind=kind, action=action)
    try:
        if action == "refused":
            writer.close()
            return
        if action == "via-proxy":
            ur, uw = await open_marked(PROXY[0], int(PROXY[1]))
            # by NAME: the proxy resolves it and connects to the real host, whatever address the client dialled
            uw.write(f"CONNECT {host}:{port} HTTP/1.1\r\nHost: {host}:{port}\r\n\r\n".encode())
            await uw.drain()
            status = await asyncio.wait_for(ur.readuntil(b"\r\n\r\n"), 30)
            if b" 200 " not in status.split(b"\r\n", 1)[0]:
                writer.close()
                uw.close()
                return
        else:
            ur, uw = await open_marked(ip, port)
        if first:
            uw.write(first)
            await uw.drain()
        await asyncio.gather(pipe(reader, uw), pipe(ur, writer))
    except (OSError, asyncio.TimeoutError, asyncio.IncompleteReadError, asyncio.LimitOverrunError):
        writer.close()


class CA(BaseHTTPRequestHandler):
    def do_GET(self):
        body = open("/ca/mitmproxy-ca-cert.pem", "rb").read()
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


async def main():
    os.makedirs("/run/mi-egress", exist_ok=True)
    subprocess.run(["nft", "-f", "-"], input=NFT, text=True, check=True)
    threading.Thread(target=refresh_proxy, daemon=True).start()
    threading.Thread(target=HTTPServer(("127.0.0.1", CA_PORT), CA).serve_forever, daemon=True).start()
    server = await asyncio.start_server(handle, "0.0.0.0", PORT, limit=1 << 20)
    open(READY, "w").close()
    log(event="ready", proxy=":".join(PROXY), allow_raw=sorted(ALLOW_RAW))
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    asyncio.run(main())
