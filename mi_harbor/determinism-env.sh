# Determinism pins for mi eval runners. Source AFTER OPENAI_BASE_URL/MODEL defaults are set.
#
# Sets MI_API_PARAMS / MI_JUDGE_PARAMS defaults:
#   - temperature 0 + seed 42 everywhere
#   - an OpenRouter provider pin (Novita, allow_fallbacks=false) only when
#     OPENAI_BASE_URL points at openrouter.ai — local servers would reject
#     the unknown `provider` field.
#
# Overrides:
#   - MI_API_PARAMS / MI_JUDGE_PARAMS from the environment win over defaults.
#   - NO_PIN=1 disables pinning entirely (provider-outage escape hatch).
#
# Provider pin rationale (endpoints API + live probes, 2026-07-06): of the
# providers that both support temperature+seed AND are allowed by this
# account's OpenRouter privacy settings (DeepInfra, GMICloud, Alibaba,
# Parasail, WandB), Alibaba has the best availability/throughput combo:
# uptime 99.70%/30m, throughput p50=68 tps, 393k max completion tokens.
# (Novita scores higher on paper but is ignored by the account's privacy
# settings; Baidu — the unpinned default route — does not support seed.)

MI_PIN_PROVIDER="${MI_PIN_PROVIDER:-alibaba}"

if [[ "${NO_PIN:-0}" == "1" ]]; then
  echo "Determinism pins: DISABLED (NO_PIN=1)"
else
  _mi_pin='{"temperature":0,"seed":42}'
  if [[ "${OPENAI_BASE_URL:-}" == *openrouter.ai* ]]; then
    _mi_pin='{"temperature":0,"seed":42,"provider":{"order":["'"$MI_PIN_PROVIDER"'"],"allow_fallbacks":false}}'
  fi
  : "${MI_API_PARAMS:=$_mi_pin}"
  : "${MI_JUDGE_PARAMS:=$MI_API_PARAMS}"
  export MI_API_PARAMS MI_JUDGE_PARAMS
  unset _mi_pin
  echo "Determinism pins:"
  echo "  MI_API_PARAMS:   $MI_API_PARAMS"
  echo "  MI_JUDGE_PARAMS: $MI_JUDGE_PARAMS"
fi
