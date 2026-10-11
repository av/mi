#!/bin/sh
set -eu
case "${1:-}" in
  shim) exec python3 /opt/mi-egress/shim.py ;;
  proxy) exec mitmdump --mode regular --listen-host 0.0.0.0 --listen-port 8080 --set confdir=/ca \
           --set block_global=false --set connection_strategy=lazy --set flow_detail=0 -q -s /opt/mi-egress/filter.py ;;
  *) echo "usage: shim|proxy" >&2; exit 2 ;;
esac
