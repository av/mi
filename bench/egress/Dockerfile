# One image for both egress services of an evaluation run: `shim` (transparent redirect, shares the task
# container's network namespace) and `proxy` (mitmproxy with filter.py). Build with bench/egress/build.sh,
# which creates the run-local CA in bench/egress/ca/ (never committed).
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends nftables curl && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir mitmproxy==11.0.2
COPY ca/mitmproxy-ca.pem ca/mitmproxy-ca-cert.pem /ca/
COPY shim.py filter.py relay.py /opt/mi-egress/
COPY --chmod=755 entrypoint.sh /opt/mi-egress/entrypoint.sh
ENTRYPOINT ["/opt/mi-egress/entrypoint.sh"]
