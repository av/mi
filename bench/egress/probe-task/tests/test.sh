#!/bin/bash
# reward 1 only when the agent-phase probe passed every route
mkdir -p /logs/verifier
if grep -q '^PROBE RESULT: PASS$' /logs/agent/probe.txt 2>/dev/null; then echo 1 > /logs/verifier/reward.txt; else echo 0 > /logs/verifier/reward.txt; fi
cat /logs/agent/probe.txt 2>/dev/null
