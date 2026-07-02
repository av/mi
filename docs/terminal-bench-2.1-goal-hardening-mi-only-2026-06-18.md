# Terminal-Bench 2.1 mi-only goal hardening run

Date: 2026-06-18 / 2026-06-19

Run root:
`bench/terminal-bench-2.1/deepseek_deepseek-v4-flash/goal-hardening-mi-only-tb21-20260618-145615`

Harbor job:
`bench/terminal-bench-2.1/deepseek_deepseek-v4-flash/goal-hardening-mi-only-tb21-20260618-145615/mi/2026-06-18__14-56-19`

Configuration:
- Dataset: `terminal-bench/terminal-bench-2-1`
- Harness: `mi`
- Model: `deepseek/deepseek-v4-flash`
- Provider API: OpenRouter OpenAI-compatible API
- `N_CONCURRENT=2`
- `N_ATTEMPTS=1`
- `LIMIT=all`
- No explicit `AGENT_TIMEOUT_MULTIPLIER`

Result:
- Score: `50/89`
- Rate: `56.2%`
- Harbor completed trials: `89/89`
- Harbor errored trials: `32`
- Output tokens: `504015`
- Started: `2026-06-18T14:56:23.638091`
- Finished: `2026-06-19T01:33:11.098448`

Comparison to the 2026-06-18 full harness snapshot:
- Previous mi: `38/89` (`42.7%`)
- Previous terminus-2: `46/89` (`51.7%`)
- Goal-hardened mi: `50/89` (`56.2%`)

Passed tasks:
`adaptive-rejection-sampler`, `bn-fit-modify`, `break-filter-js-from-html`, `build-pmars`, `caffe-cifar-10`, `cancel-async-tasks`, `cobol-modernization`, `code-from-image`, `compile-compcert`, `configure-git-webserver`, `constraints-scheduling`, `count-dataset-tokens`, `crack-7z-hash`, `custom-memory-heap-crash`, `distribution-search`, `feal-differential-cryptanalysis`, `feal-linear-cryptanalysis`, `financial-document-processor`, `fix-code-vulnerability`, `fix-git`, `fix-ocaml-gc`, `git-leak-recovery`, `headless-terminal`, `hf-model-inference`, `large-scale-text-editing`, `largest-eigenval`, `llm-inference-batching-scheduler`, `log-summary-date-ranges`, `mailman`, `mcmc-sampling-stan`, `merge-diff-arc-agi-task`, `modernize-scientific-stack`, `multi-source-data-merger`, `nginx-request-logging`, `openssl-selfsigned-cert`, `polyglot-c-py`, `polyglot-rust-c`, `portfolio-optimization`, `pypi-server`, `pytorch-model-cli`, `pytorch-model-recovery`, `query-optimize`, `regex-log`, `reshard-c4-data`, `sam-cell-seg`, `sparql-university`, `sqlite-db-truncate`, `sqlite-with-gcov`, `tune-mjcf`, `vulnerable-secret`.

Failed tasks:
`build-cython-ext`, `build-pov-ray`, `chess-best-move`, `circuit-fibsqrt`, `db-wal-recovery`, `dna-assembly`, `dna-insert`, `extract-elf`, `extract-moves-from-video`, `filter-js-from-html`, `gcode-to-text`, `git-multibranch`, `gpt2-codegolf`, `install-windows-3.11`, `kv-store-grpc`, `make-doom-for-mips`, `make-mips-interpreter`, `model-extraction-relu-logits`, `mteb-leaderboard`, `mteb-retrieve`, `overfull-hbox`, `password-recovery`, `path-tracing`, `path-tracing-reverse`, `protein-assembly`, `prove-plus-comm`, `qemu-alpine-ssh`, `qemu-startup`, `raman-fitting`, `regex-chess`, `rstan-to-pystan`, `sanitize-git-repo`, `schemelike-metacircular-eval`, `torch-pipeline-parallelism`, `torch-tensor-parallelism`, `train-fasttext`, `video-processing`, `winning-avg-corewars`, `write-compressor`.

Notable residual issue:
`build-pov-ray` was an agent-level ACK but verifier failure. The judge accepted a render sanity check while missing verifier-specific authentic-source files and lowercase include path expectations.
