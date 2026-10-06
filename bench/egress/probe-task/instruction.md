Synthetic infrastructure probe (no model involved): bench/egress/probe.sh is run in this container during the
agent phase and its output is written to /logs/agent/probe.txt. The verifier passes when every route in it
reports PASS.
