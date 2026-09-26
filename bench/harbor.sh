#!/usr/bin/env bash
# Pinned Harbor CLI with the mi adapter (bench.mi_agent) importable.
#   bench/harbor.sh run -c bench/configs/mi.yaml -c bench/configs/smoke.yaml
#   bench/harbor.sh view jobs
set -euo pipefail
cd "$(dirname "$0")/.."
export PYTHONPATH="$PWD${PYTHONPATH:+:$PYTHONPATH}"
exec uvx --from "harbor==${HARBOR_VERSION:-0.23.0}" harbor "$@"
