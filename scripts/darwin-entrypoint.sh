#!/usr/bin/env bash
# darwin-entrypoint.sh — the darwin evaluator entrypoint (ADR-0005, lever E).
#
# Usage (from dream.config.json evaluatorEntrypoints.darwin):
#   RUVLLM_TIMEOUT_MS=180000 ./scripts/darwin-entrypoint.sh \
#     npx @metaharness/darwin@0.10.2 evolve . --sandbox mock ...
#
# Runs the given darwin command through this repo's own
# `dream-machine verify-entrypoint darwin`, which classifies liveness and checks
# the printed leaderboard against DARWIN_BOUNDS (packages/cli/src/darwinBounds.ts).
# The leaderboard is parsed once, by the CLI, from the run it executed itself;
# --passthrough keeps darwin's own output in the evaluator receipt.
#
# The darwin command stays in dream.config.json, not in this script, so the
# dream-engine admission check (darwin recognised by package name, refused
# without --sandbox mock|agent) and the compiled-prompt pin test both still see it.
#
# With --mutator ruvllm, darwin's mutator is routed through a loopback shim
# (packages/cli/src/loomShim.ts, ADR-0007) that turns the Ontology Loom's
# scaffold off and outlasts darwin@0.10.2's hard-coded 30 s fetch abort, so
# RUVLLM_TIMEOUT_MS takes effect. Without it every mutation is a no-op and every
# mutant scores the baseline (the 0.765 nights). The shim logs one line per
# mutator call and a per-verdict summary to stderr, into the receipt, and writes
# its counts to a stats file that verify-entrypoint reads (--shim-stats).
#
# Exit status:
#   0   darwin live, bounds respected
#   1   darwin failed (blocked)
#   2   darwin exited 0 with no output (suspicious-silent)
#   3   darwin live but its leaderboard breached a bound, could not be parsed,
#       or scored every mutant identically (ADR-0006) with no real mutation:
#       for --mutator ruvllm, uniformity fails only when the shim counted 0
#       real model edits or left no summary; otherwise it is a receipt note
#       ("no improvement found", ADR-0007). Without the shim the rule is strict.
#  64  refused: the command is not an exact-pinned darwin run in a mock/agent
#       sandbox whose head is `npx <pin>` (ADR-0008: the pin owns resolution)
#   69  the CLI is not built (run `npm run build`)
set -euo pipefail

die() {
  local status=$1
  shift
  printf 'darwin-entrypoint: %s\n' "$*" >&2
  exit "$status"
}

[ "$#" -gt 0 ] || die 64 "usage: $0 <darwin command...> (e.g. npx @metaharness/darwin@X.Y.Z evolve . --sandbox mock)"

# Pin discipline: every darwin package reference is an exact semver pin, and
# there is exactly one version. An unpinned npx runs whatever resolves tonight.
pins=()
sandbox=""
mutator=""
ruvllm_url=""
prev=""
seen_flags=""
for arg in "$@"; do
  case "$arg" in
    @metaharness/darwin@*)
      [[ "$arg" =~ ^@metaharness/darwin@[0-9]+\.[0-9]+\.[0-9]+$ ]] ||
        die 64 "darwin must be pinned to an exact version, got '$arg'"
      pins+=("$arg")
      ;;
    @metaharness/darwin | metaharness-darwin)
      die 64 "darwin must be pinned to an exact version, got unpinned '$arg'"
      ;;
    # darwin@0.10.2 reads only the `--flag value` spelling and silently ignores
    # `--flag=value`: `--sandbox=mock` would run the default real sandbox.
    --sandbox=* | --mutator=* | --ruvllm-url=* | --ruvllm-model=*)
      die 64 "darwin ignores '$arg': write '${arg%%=*} ${arg#*=}' (darwin reads only the space-separated form)"
      ;;
    # A repeated tracked flag makes the wrapper's reading ambiguous: it checks
    # the value after the LAST occurrence, darwin might take the first
    # (`--sandbox real --sandbox mock` would run the real sandbox while this
    # script checks mock). Each tracked flag must appear exactly once.
    --sandbox | --mutator | --ruvllm-url | --ruvllm-model)
      case ",$seen_flags," in
        *",$arg,"*)
          die 64 "flag '$arg' appears more than once: a repeated flag makes the checked value ambiguous"
          ;;
      esac
      seen_flags="$seen_flags,$arg"
      ;;
  esac
  [ "$prev" = "--sandbox" ] && sandbox=$arg
  [ "$prev" = "--mutator" ] && mutator=$arg
  [ "$prev" = "--ruvllm-url" ] && ruvllm_url=$arg
  prev=$arg
done

[ "${#pins[@]}" -gt 0 ] || die 64 "no pinned @metaharness/darwin@X.Y.Z in the command"
for pin in "${pins[@]}"; do
  [ "$pin" = "${pins[0]}" ] || die 64 "conflicting darwin pins: ${pins[0]} and $pin"
done

# ADR-0008 (structure, not tokens): the checks above prove the right tokens are
# present, but tokens do not bind a command — `bash -c 'evil' <pin> evolve .
# --sandbox mock` carries every required token while its head runs something
# else as the darwin evaluator, and pre-pin npx flags (--node-options, -p,
# --yes) resolve code the pin never chose. The head must be exactly `npx <pin>`:
# npx resolves the package named by its first non-flag argument, so with the pin
# in position 2 nothing can be resolved ahead of it. The test suite reaches its
# stub the same way, through a PATH-shimmed npx (darwinEntrypoint.test.ts).
[ "${1-}" = "npx" ] && [ "${2-}" = "${pins[0]}" ] ||
  die 64 "the darwin command must start with 'npx ${pins[0]}' so the pin owns resolution (ADR-0008), got head '${1-} ${2-}'"

# ADR-065 (dream-engine): the default 'real' sandbox is surface-independent.
case "$sandbox" in
  mock | agent) ;;
  "") die 64 "darwin needs --sandbox mock or --sandbox agent (the default 'real' sandbox is not probative)" ;;
  *) die 64 "darwin sandbox '$sandbox' refused: use --sandbox mock or --sandbox agent" ;;
esac

# ADR-0007: the Loom door must be named; darwin's localhost:8080 default is
# never the Loom, and an unreachable mutator silently no-ops every mutation.
if [ "$mutator" = "ruvllm" ] && [ -z "$ruvllm_url" ]; then
  die 64 "darwin --mutator ruvllm needs an explicit --ruvllm-url (the Loom door)"
fi

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cli="$repo_root/packages/cli/dist/bin.js"
[ -f "$cli" ] || die 69 "$cli not found: run 'npm ci && npm run build' first"

shim_pid=""
shim_dir=""
shim_stats=""
stop_shim() {
  if [ -n "$shim_pid" ]; then
    # TERM makes the shim print its per-verdict summary; wait so it lands
    # in the receipt before this script exits.
    kill -TERM "$shim_pid" 2>/dev/null || true
    wait "$shim_pid" 2>/dev/null || true
    shim_pid=""
  fi
  [ -n "$shim_dir" ] && rm -rf -- "$shim_dir"
  shim_dir=""
}
trap stop_shim EXIT

if [ "$mutator" = "ruvllm" ]; then
  shim_bin="$repo_root/packages/cli/dist/loomShimBin.js"
  [ -f "$shim_bin" ] || die 69 "$shim_bin not found: run 'npm ci && npm run build' first"
  shim_dir=$(mktemp -d)
  shim_stats="$shim_dir/stats.json"
  node "$shim_bin" --upstream "$ruvllm_url" --url-file "$shim_dir/url" --stats-file "$shim_stats" &
  shim_pid=$!
  for _ in $(seq 1 100); do
    [ -s "$shim_dir/url" ] && break
    kill -0 "$shim_pid" 2>/dev/null || die 1 "loom shim exited before it was ready"
    sleep 0.1
  done
  [ -s "$shim_dir/url" ] || die 1 "loom shim not ready after 10 s"
  shim_url=$(cat -- "$shim_dir/url")

  # Point darwin at the shim; every other argument passes through verbatim.
  args=()
  prev=""
  for arg in "$@"; do
    if [ "$prev" = "--ruvllm-url" ]; then
      args+=("$shim_url")
    else
      args+=("$arg")
    fi
    prev=$arg
  done
  set -- "${args[@]}"
fi

# Re-quote the argv into one shell-safe string for --cmd; verify-entrypoint
# runs it through a shell, so arguments with spaces or metacharacters survive.
printf -v darwin_cmd '%q ' "$@"

# ADR-0007: with the shim, verify-entrypoint reads its real-mutation count, and a
# uniform leaderboard fails only when that count is 0 (or the summary is missing).
verify_extra=()
[ -n "$shim_stats" ] && verify_extra=(--shim-stats "$shim_stats")

cd -- "$repo_root"
status=0
node "$cli" verify-entrypoint darwin --passthrough "${verify_extra[@]}" --cmd "${darwin_cmd% }" || status=$?
stop_shim
exit "$status"
