# DeepSeek-V4-Flash — Terminal-Bench 2.0

Model: deepseek/deepseek-v4-flash (OpenRouter)
Benchmark: terminal-bench@2.0 (89 tasks)

## Structure

- `mi/`        — runs using this repo's mi agent (via mi_harbor adapter)
- `terminus/`  — runs using Harbor's Terminus agent (strong reference harness for comparison)

## Run naming

`YYYY-MM-DD_Ntasks_<notes>/`

Inside each run dir put:
- `command.sh`   (exact command)
- `score.txt`    (pass rate + raw numbers)
- `notes.md`     (key observations, cost, duration, failure modes)
- `job/`         (copy or symlink to the Harbor job output dir)

## Current 10-task estimator preset

See `mi_harbor/presets/openrouter-deepseek-v4-flash-tb2-10.sh`

Tasks (stratified for best extrapolation):
count-dataset-tokens, train-fasttext, caffe-cifar-10, fix-code-vulnerability,
sanitize-git-repo, adaptive-rejection-sampler, dna-assembly, fix-git,
torch-tensor-parallelism, gpt2-codegolf

## 30-task side-by-side eval (mi vs. another harness)

See `mi_harbor/presets/openrouter-deepseek-v4-flash-tb2-30.sh`

This preset runs the 30-task set with the mi adapter (n-concurrent=1 for diagnostics).
It is the concrete artifact for advancing the timeboxed 30-task Terminal-Bench goal.

**Selection criteria** (documented in preset header):
- Start with the validated 10-task stratified set (best 10 for extrapolation).
- Add 20 more tasks drawn from prior jobs/bench runs + new ones.
- Stratify across categories for diversity: ML/data (llm-inference-*, pytorch-*, hf-*, train-*, reshard-*, count-*), SWE/git (fix-*, sanitize-*, merge-*, configure-git-*, gpt2-codegolf), security/crypto (fix-code-vuln, crack-7z, openssl-*, vulnerable-*), scientific (mcmc-*, path-tracing, raman if avail), systems (qemu-*, db-wal-*, largest-eigenval), games/algos (regex-chess, chess-best-move, winning-avg-corewars), polyglot, etc.
- Ensures coverage beyond the original 10 while keeping run feasible.

**30 tasks list**:
count-dataset-tokens train-fasttext caffe-cifar-10 fix-code-vulnerability sanitize-git-repo adaptive-rejection-sampler dna-assembly fix-git torch-tensor-parallelism gpt2-codegolf llm-inference-batching-scheduler break-filter-js-from-html reshard-c4-data write-compressor merge-diff-arc-agi-task winning-avg-corewars log-summary-date-ranges pytorch-model-cli largest-eigenval regex-chess crack-7z-hash db-wal-recovery path-tracing polyglot-c-py mcmc-sampling-stan hf-model-inference qemu-startup configure-git-webserver chess-best-move openssl-selfsigned-cert

**Live batch status (timeboxed 30-task eval, collection + edge coverage unit ~02:05 CEST 2026, after 5 monitor/agg cycles + batch5)**:
- Batch 1 (2 tasks): regex-chess, crack-7z-hash — launched iter1 (PIDs 1089838 mi still 0/2 regex-chess active / 1090236 terminus finished); **real final for terminus: 1/2 (50%) — crack-7z-hash=pass, regex-chess=fail**; snapshot `2026-05-19_batch1_regex-chess_crack7z_terminus_final/`
- Batch 2 (4 tasks): fix-git, db-wal-recovery, path-tracing, polyglot-c-py — launched iter2; **mi FINAL 4/4 completed, Pass rate 1/4 (25%) — fix-git=pass only** (new final snapshot `2026-05-19_batch2_4task_fixgit_dbwal_path_polyglot_mi_final/`); term 2/4 1 pass (fix-git); old partial also present
- Batch 3 (5 tasks): largest-eigenval, mcmc-sampling-stan, hf-model-inference, qemu-startup, configure-git-webserver — launched iter3; **mi 3/5 3/3 passes** (`largest-eigenval`, `configure-git-webserver`, `hf-model-inference`); new partial snapshot `2026-05-19_batch3_5task_largest_mcmc_hf_qemu_configure_mi_partial/`; term 4/5 2 passes (`configure-git-webserver`, `qemu-startup`); paired term snapshot `..._term_partial/`
- Batch 4 (3 tasks): chess-best-move, openssl-selfsigned-cert, train-fasttext — launched iter4 (PIDs 1382249/1386919); term reached 2/3 0 passes; mi 0/3; live /tmp/mi-30-eval-iter4-*
- **Batch 5 (2 tasks, launched this unit)**: winning-avg-corewars + gpt2-codegolf (games/algos + polyglot; chosen for diversity/edge from pending when docker=8); launched iter5 ~01:55 when active <14-15; PIDs mi 1673223 / term 1676335; 0/2 yet; logs /tmp/mi-30-eval-iter5-*.log + /tmp/launch-batch5.sh ; now 16/30 covered
- **New real snapshots this unit (from 5 cycles, high n_completed / new reward=1)**: mi batch3 (3/3 passes: largest-eigenval+configure+hf-model), term batch3 (2/4 on 4/5), mi batch2 final (1/4 fix-git); plus prior batch1 term 1/2 + batch2 mi partial; total run dirs now 74+; 5 cycles (90-180s sleeps) + batch5
- Monitor/agg robust, detect all iters 1-5 + new bench/ dirs; live rewards accurate via reward.txt scan
- 10-task: mi 2/10 in `2026-05-18_10task_estimator/`
- See `current-results-summary.md` (full updated with 5 cycles, exact new pass lists/rates, batch5 PIDs, grand ~6 mi vs ~4 term, 16/30, projection) for details + 6am plan.

**Another harness defined**: `terminus` / `terminus-2`
- The official/reference Terminal-Bench harness/agent bundled with Harbor.
- Provides strong baseline (full ATIF trajectories, episode recordings, higher reliability on hard tasks).
- Used for all prior "terminus/" results in this bench/ tree.
- Side-by-side protocol: run identical `harbor run --dataset terminal-bench@2.0 --model openai/deepseek/deepseek-v4-flash` once with `--agent-import-path mi_harbor.mi_agent:MiAgent` (mi) and once with `--agent terminus-2` (reference), same --include-task-name filters and --n-tasks.
- Results land in separate job dirs under mi/ vs. terminus/ for diffing pass@1, cost, latency, failure modes.

Run example for terminus on the 30 (or subset):
  ./mi_harbor/presets/openrouter-deepseek-v4-flash-tb2-30.sh --agent terminus-2 --agent-import-path '' --n-concurrent 4

Keep all logs/job dirs under bench/... for comparison.

## Other harness

Using `terminus` (or `terminus-2`) via:
harbor run --agent terminus ... --model openai/deepseek/deepseek-v4-flash

Keep logs here for direct apples-to-apples comparison with the mi numbers.