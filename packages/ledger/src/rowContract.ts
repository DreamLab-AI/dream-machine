// Ledger row contract validator — dream-cycle 2026-09-06, deep: ledger-signals.
// Enforces the machine-readable invariants of docs/dream-cycle/LEDGER.md rows:
// finding is concrete and self-contained (<= 80 chars, no pointers, no
// frozen-hypothesis leakage); prior-night fates are token-only (#N:FATE with
// FATE in MERGED|CLOSED|OPEN|STALE); ACCEPT rows track a PR and carry a witness.
// Rows dated before `enforceFrom` are grandfathered.
//
// This module is the single source of the row vocabulary. `index.ts` imports
// these constants rather than restating them, because a validator that
// disagrees with the verifier is worse than neither.

export interface RowViolation {
  date: string;
  rule: string;
  detail: string;
}

/**
 * Verdicts a completed dream NIGHT may end in — exactly one, never a fourth.
 * This is the three-state invariant of ADR-0001 and the compiled prompt, and it
 * is unchanged: a night that ran still resolves to accept, reject, or "could not
 * distinguish candidate from baseline".
 */
export const NIGHT_VERDICTS = ["ACCEPT", "REJECT", "INCONCLUSIVE"] as const;

/**
 * Verdicts for ledger rows that are NOT nights. A row can record something other
 * than a completed experiment — an environment that never let one start, a
 * handoff, an operator acting directly on the repo — and such a row must be
 * distinguishable from a night that ran and could not decide.
 *
 * The distinction is load-bearing downstream, not cosmetic: the engine counts
 * INCONCLUSIVE rows toward the dry streak that parks a repo, and ignores any
 * other token. Filing an operator handoff as INCONCLUSIVE therefore pushes the
 * repo toward being parked on the strength of work that was never attempted.
 *
 * - BLOCKED-ENV: the environment prevented the night from running at all.
 * - HANDOFF:     the night handed its work to another actor rather than deciding.
 * - OPERATOR:    a human/operator acted on the repo outside the nightly loop.
 */
export const NON_NIGHT_VERDICTS = ["BLOCKED-ENV", "HANDOFF", "OPERATOR"] as const;

/** Every verdict token a ledger row may carry. */
export const LEDGER_VERDICTS: readonly string[] = [...NIGHT_VERDICTS, ...NON_NIGHT_VERDICTS];

/**
 * Evaluated-column vocabulary. "n/a" belongs to non-night rows: an operator
 * handoff did not evaluate anything, and saying "no" would imply a night chose
 * not to.
 */
export const LEDGER_EVALUATED: readonly string[] = ["yes", "no", "blocked", "n/a"];

const FATE_TOKEN = /^#\d+:(MERGED|CLOSED|OPEN|STALE)$/;

/** Parse a markdown table line into its 10 ledger cells, or null if not a row. */
export function parseRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return null;
  // Split on unescaped pipes only: escapeCell renders a cell's pipes as `\|`,
  // and a split inside a cell would misalign every cell validated below.
  const cells = trimmed
    .replace(/\\\|/g, "\u0000")
    .split("|")
    .map((cell) => cell.trim().replace(/\u0000/g, "|"));
  if (cells.length < 12) return null;
  return cells.slice(1, 11);
}

/** Validate one parsed row (10 cells). Rows dated before enforceFrom are skipped. */
export function validateRow(cells: string[], enforceFrom: string): RowViolation[] {
  const violations: RowViolation[] = [];
  const at = (index: number): string => (cells[index] ?? "");
  const date = at(0);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return violations;
  if (date < enforceFrom) return violations;

  const flag = (rule: string, detail: string): void => {
    violations.push({ date, rule, detail });
  };

  const finding = at(2);
  if (finding.length === 0) flag("finding-empty", "finding column is empty");
  if (finding.length > 80) flag("finding-too-long", `${finding.length} chars > 80`);
  if (/\bsee\s+(report|gist)\b/i.test(finding) || /^(see|gist)\b/i.test(finding)) {
    flag("finding-pointer", "finding points elsewhere instead of stating the result");
  }
  if (/^given\b/i.test(finding)) {
    flag("finding-hypothesis-leak", "finding column contains frozen-hypothesis text");
  }

  const verdict = at(6);
  if (!LEDGER_VERDICTS.includes(verdict)) {
    flag("verdict-vocab", `unrecognised verdict "${verdict}"`);
  }
  if (verdict === "ACCEPT" && (at(4) === "NONE" || at(4) === "")) {
    flag("accept-without-pr", "ACCEPT rows must record PR as pending or #N");
  }
  if (verdict === "ACCEPT" && at(8) === "") {
    flag("accept-without-witness", "ACCEPT rows must carry a witness");
  }

  const fates = at(9);
  if (fates !== "" && !fates.split(/\s+/).every((token) => FATE_TOKEN.test(token))) {
    flag("fates-grammar", "prior-night fates must be space-separated #N:FATE tokens only");
  }

  return violations;
}

/** Validate a whole ledger file body. */
export function validateLedger(text: string, enforceFrom: string): RowViolation[] {
  const violations: RowViolation[] = [];
  for (const line of text.split(/\r?\n/)) {
    const cells = parseRow(line);
    if (cells !== null) violations.push(...validateRow(cells, enforceFrom));
  }
  return violations;
}
