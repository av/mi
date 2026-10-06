#!/bin/sh
# Build the egress image (mi-egress:1). The CA that the filtering proxy signs with is created once in
# bench/egress/ca/ (gitignored); its public certificate is what the adapter installs in the task container.
set -eu
cd "$(dirname "$0")"
mkdir -p ca
if [ ! -f ca/mitmproxy-ca.pem ]; then
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj "/CN=mi evaluation egress CA" \
    -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -keyout ca/key.pem -out ca/mitmproxy-ca-cert.pem 2>/dev/null
  cat ca/key.pem ca/mitmproxy-ca-cert.pem > ca/mitmproxy-ca.pem
  rm ca/key.pem
  chmod 600 ca/mitmproxy-ca.pem
fi
docker build -q -t mi-egress:1 .
