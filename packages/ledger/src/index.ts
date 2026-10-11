/**
 * @dream-machine/ledger
 *
 * The ledger is the Dream Machine's only durable cross-night memory. Every
 * nightly run appends exactly one row to `docs/dream-cycle/LEDGER.md`, a
 * fixed 10-column GitHub-flavored-markdown table:
 *
 *   | Date | Deep | Finding | Issue | PR | Evaluated? | Verdict | Effect | Witness | Prior-night fates |
 *
 * This module parses, validates, and appends rows deterministically, and turns
 * the accumulated history into the STEP 1.1 "learning signals" that steer the
 * next night — instead of the model re-deriving them from prose every time.
 */

import { LEDGER_EVALUATED, LEDGER_VERDICTS } from "./rowContract.js";

export const LEDGER_COLUMNS = [
  'Date',
  'Deep',
  'Finding',
  'Issue',
  'PR',
  'Evaluated?',
  'Verdict',
  'Effect',
  'Witness',
  'Prior-night fates',
] as const;

/**
 * A night's outcome, or a marker that the row is not a night at all. The first
 * three are the ADR-0001 three-state invariant; the rest describe rows that
 * record something other than a completed experiment. The split matters
 * downstream: the engine's dry streak counts INCONCLUSIVE and ignores the rest,
 * so an operator handoff filed as INCONCLUSIVE parks the repo on work nobody
 * attempted. Vocabulary lives in rowContract.ts.
 */
export type Verdict =
  | 'ACCEPT'
  | 'REJECT'
  | 'INCONCLUSIVE'
  | 'BLOCKED-ENV'
  | 'HANDOFF'
  | 'OPERATOR';
export type Evaluated = 'yes' | 'no' | 'blocked' | 'n/a';

export interface LedgerRow {
  date: string; // YYYY-MM-DD
  deep: string;
  finding: string;
  issue: string; // "#123" | "LOCAL" | "NONE"
  pr: string; // "#123" | "NONE"
  evaluated: Evaluated | string;
  verdict: Verdict | string;
  effect: string;
  witness: string; // short prefix, e.g. "398c71a6"
  priorFates: string;
}

const HEADER = `| ${LEDGER_COLUMNS.join(' | ')} |`;
const DIVIDER = `| ${LEDGER_COLUMNS.map(() => '---').join(' | ')} |`;

/** The empty ledger — header + divider, ready for the first append. */
export function emptyLedger(): string {
  return `${HEADER}\n${DIVIDER}\n`;
}

function splitRow(line: string): string[] {
  // Trim the leading/trailing pipe, then split on unescaped pipes. escapeCell
  // renders a cell's pipes as `\|`; splitting on every `|` would break inside
  // the cell and shift every later column, so stash the escape, split, restore.
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed
    .replace(/\\\|/g, '\u0000')
    .split('|')
    .map((c) => c.trim().replace(/\u0000/g, '|'));
}

function isDivider(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^:?-{3,}:?$/.test(c.replace(/\s/g, '')));
}

/** Escape a cell value so it cannot break the table (pipes/newlines). */
export function escapeCell(value: string): string {
  return String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|')
    .trim();
}

function rowToCells(row: LedgerRow): string[] {
  return [
    row.date,
    row.deep,
    row.finding,
    row.issue,
    row.pr,
    row.evaluated,
    row.verdict,
    row.effect,
    row.witness,
    row.priorFates,
  ].map(escapeCell);
}

function cellsToRow(cells: string[]): LedgerRow {
  const [date, deep, finding, issue, pr, evaluated, verdict, effect, witness, priorFates] = cells;
  return {
    date: date ?? '',
    deep: deep ?? '',
    finding: finding ?? '',
    issue: issue ?? '',
    pr: pr ?? '',
    evaluated: evaluated ?? '',
    verdict: verdict ?? '',
    effect: effect ?? '',
    witness: witness ?? '',
    priorFates: priorFates ?? '',
  };
}

export interface ParseResult {
  rows: LedgerRow[];
  /** Non-fatal issues (malformed rows skipped, wrong column count, etc.). */
  warnings: string[];
}

/** Parse a LEDGER.md string into typed rows (skips header/divider/blank lines). */
export function parseLedger(markdown: string): ParseResult {
  const rows: LedgerRow[] = [];
  const warnings: string[] = [];
  const lines = markdown.split(/\r?\n/);
  let seenHeader = false;
  for (const line of lines) {
    if (!line.trim() || !line.includes('|')) continue;
    const cells = splitRow(line);
    if (isDivider(cells)) continue;
    // First pipe-row is the header.
    if (!seenHeader) {
      seenHeader = true;
      if (cells[0]?.toLowerCase() !== 'date') {
        warnings.push(`first table row is not the expected header (got "${cells[0]}")`);
      }
      continue;
    }
    if (cells.length !== LEDGER_COLUMNS.length) {
      warnings.push(`row has ${cells.length} columns, expected ${LEDGER_COLUMNS.length}: ${line.trim()}`);
      // Pad/truncate defensively so a malformed row is still readable.
    }
    rows.push(cellsToRow(cells));
  }
  return { rows, warnings };
}

/** Render a single row as a markdown table line. */
export function renderRow(row: LedgerRow): string {
  return `| ${rowToCells(row).join(' | ')} |`;
}

/**
 * Append a row to a ledger string, creating the header if absent. Guarantees
 * exactly one row is added and the schema is unchanged (property-tested).
 */
export function appendRow(markdown: string, row: LedgerRow): string {
  const base = markdown && markdown.trim().length ? markdown.replace(/\s*$/, '') : emptyLedger().replace(/\s*$/, '');
  return `${base}\n${renderRow(row)}\n`;
}

// Imported, never restated: verifyLedger and the row contract must agree, or a
// row passes one gate and fails the other.
const VERDICTS = LEDGER_VERDICTS;
const EVALS = LEDGER_EVALUATED;

export interface VerifyResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  rowCount: number;
}

/** Structurally verify a ledger: header present, verdicts/evaluated in range. */
export function verifyLedger(markdown: string): VerifyResult {
  const errors: string[] = [];
  const { rows, warnings } = parseLedger(markdown);
  if (!markdown.includes(HEADER.replace(/\s/g, '')) && !/\|\s*Date\s*\|/.test(markdown)) {
    errors.push('ledger is missing the Date header row');
  }
  rows.forEach((r, i) => {
    if (r.verdict && !VERDICTS.includes(r.verdict)) {
      errors.push(`row ${i + 1}: verdict "${r.verdict}" not in ${VERDICTS.join('|')}`);
    }
    if (r.evaluated && !EVALS.includes(r.evaluated)) {
      errors.push(`row ${i + 1}: evaluated "${r.evaluated}" not in ${EVALS.join('|')}`);
    }
    if (r.date && !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) {
      errors.push(`row ${i + 1}: date "${r.date}" is not YYYY-MM-DD`);
    }
  });
  return { ok: errors.length === 0, errors, warnings, rowCount: rows.length };
}

// ---------------------------------------------------------------------------
// STEP 1.1 learning signals — deterministic library code, not LLM re-derivation.
// ---------------------------------------------------------------------------

export interface LearningSignals {
  /** No candidate PR merged in the last `window` nights → prefer tiny candidates. */
  zeroMergeStreak: boolean;
  /** A finding substring seen in >= 3 prior rows → duplicate direction, rotate. */
  duplicateDirections: string[];
  /** >= 3 consecutive gist self-scores < 5 → reduce to a single deep surface. */
  lowScoreStreak: boolean;
  /** Long run of evaluated=blocked → bias to no-model-call candidates. */
  blockedEvalStreak: boolean;
  /** Count of nights considered. */
  nightsConsidered: number;
}

export interface SignalOptions {
  /** How many trailing nights to consider for merge/blocked streaks. */
  window?: number;
  /** Recent gist self-scores (0–10), most-recent last. */
  recentScores?: number[];
  /** Which PR numbers actually merged (so we can detect the zero-merge streak). */
  mergedPrNumbers?: Set<string>;
}

function prNumber(pr: string): string | null {
  const m = pr.match(/#?(\d+)/);
  return m ? m[1] : null;
}

const FATE_TOKEN = /#(\d+)\s*:\s*(MERGED|CLOSED|OPEN|STALE)\b/gi;

/**
 * Parse `#<PR>:<FATE>` tokens out of the ledger's "Prior-night fates" column
 * (populated by each night's STEP-1 fate check). Only this explicit token
 * form is recognized — free prose in the column is never mistaken for a fate
 * claim. Later rows win when the same PR is mentioned more than once.
 */
export function parsePriorFates(rows: LedgerRow[]): Map<string, string> {
  const fates = new Map<string, string>();
  for (const r of rows) {
    for (const m of r.priorFates.matchAll(FATE_TOKEN)) {
      fates.set(m[1], m[2].toUpperCase());
    }
  }
  return fates;
}

/** Compute the STEP 1.1 learning signals from parsed rows. */
export function learningSignals(rows: LedgerRow[], opts: SignalOptions = {}): LearningSignals {
  const window = opts.window ?? 14;
  const recent = rows.slice(-window);

  // Zero-merge streak: no PR in the window is known-merged. Merge status can
  // come from an explicit `mergedPrNumbers` option (e.g. a live API lookup)
  // and/or from `#N:MERGED` tokens already recorded in-ledger by prior
  // nights' fate checks — the latter is the only source the CLI has today.
  const fatesFromLedger = parsePriorFates(rows);
  const mergedFromLedger = new Set(
    [...fatesFromLedger.entries()].filter(([, fate]) => fate === 'MERGED').map(([pr]) => pr),
  );
  const merged = opts.mergedPrNumbers
    ? new Set([...opts.mergedPrNumbers, ...mergedFromLedger])
    : mergedFromLedger;
  const prsInWindow = recent.map((r) => prNumber(r.pr)).filter((n): n is string => !!n);
  const zeroMergeStreak = prsInWindow.length > 0 && prsInWindow.every((n) => !merged.has(n));

  // Duplicate directions: normalized finding text repeated >= 3 times.
  const counts = new Map<string, number>();
  for (const r of rows) {
    const key = r.finding.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).slice(0, 6).join(' ').trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const duplicateDirections = [...counts.entries()].filter(([, c]) => c >= 3).map(([k]) => k);

  // Low-score streak: last 3 scores all < 5.
  const scores = opts.recentScores ?? [];
  const lastThree = scores.slice(-3);
  const lowScoreStreak = lastThree.length === 3 && lastThree.every((s) => s < 5);

  // Blocked-eval streak: majority of the window blocked, and last 3 all blocked.
  const lastThreeEvals = recent.slice(-3).map((r) => r.evaluated);
  const blockedEvalStreak =
    recent.length >= 3 && lastThreeEvals.length === 3 && lastThreeEvals.every((e) => e === 'blocked');

  return {
    zeroMergeStreak,
    duplicateDirections,
    lowScoreStreak,
    blockedEvalStreak,
    nightsConsidered: recent.length,
  };
}

// ---------------------------------------------------------------------------
// Harness-change proposer — the smallest real instance of the AutoDesign outer
// loop (arXiv:2608.13560; see docs/dream-engine/ADR-DL-001). Reads the learning
// signals (the optimisation record ℒ, already distilled by learningSignals) and
// proposes AT MOST ONE bounded, single-component harness change. Deterministic
// and side-effect free: it never mutates config and never merges — output is a
// draft for a human to weigh, preserving "evaluation is not promotion".
// ---------------------------------------------------------------------------

/**
 * The five harness components (AutoDesign §2.1). Restricting a proposal to a
 * single component keeps credit assignment interpretable: a change and its
 * effect are attributable to one named surface.
 */
export type HarnessComponent =
  | 'context-memory' // the ledger, prompts, ingested context, reusable skills
  | 'tools-specs' // evaluator entrypoints, config constraints, provenance
  | 'execution-runtime' // build step, sandbox, model/runtime availability
  | 'orchestration' // slot rotation, DEEP/SCAN surfaces, candidate sizing, budgets
  | 'evaluation-feedback'; // evaluators, adversarial critic, acceptance thresholds

/** All harness components, in a stable order — for iteration and validation. */
export const HARNESS_COMPONENTS: readonly HarnessComponent[] = [
  'context-memory',
  'tools-specs',
  'execution-runtime',
  'orchestration',
  'evaluation-feedback',
] as const;

export interface HarnessProposal {
  /** The single component this proposal touches (AutoDesign: one per iteration). */
  component: HarnessComponent;
  /** The learning-signal field that triggered the proposal. */
  trigger: keyof LearningSignals;
  /** Why the change is proposed, grounded in the signal. */
  rationale: string;
  /** A bounded, human-reviewable action to consider — never auto-applied. */
  suggestedAction: string;
}

/**
 * Propose at most one bounded harness change from the learning signals.
 *
 * Signals are considered in descending severity — a stalled merge pipeline is
 * more existential than a stuck search direction — and the first that fires
 * wins, so exactly one component is ever proposed per call (or none). This is
 * intentionally deterministic and rule-based: a v0 optimiser `P` whose output
 * is auditable and testable, not an LLM re-derivation.
 */
export function proposeHarnessChange(signals: LearningSignals): HarnessProposal | null {
  if (signals.zeroMergeStreak) {
    return {
      component: 'orchestration',
      trigger: 'zeroMergeStreak',
      rationale:
        `No candidate PR has merged across the last ${signals.nightsConsidered} night(s) ` +
        'considered — candidates are likely too large or too risky to land.',
      suggestedAction:
        'Narrow candidate scope in the orchestration component: reduce the per-night ' +
        'change budget and prefer the smallest viable candidate until a merge lands.',
    };
  }
  if (signals.lowScoreStreak) {
    return {
      component: 'evaluation-feedback',
      trigger: 'lowScoreStreak',
      rationale:
        'The last three gist self-scores were all below 5 — the harness is producing ' +
        'weak candidates that the current critic still lets through.',
      suggestedAction:
        'Tighten the evaluation-feedback component: strengthen the adversarial critic or ' +
        'raise the acceptance threshold so weak candidates are rejected earlier.',
    };
  }
  if (signals.blockedEvalStreak) {
    return {
      component: 'execution-runtime',
      trigger: 'blockedEvalStreak',
      rationale:
        'The last three nights all evaluated as blocked — the runtime cannot reach the ' +
        'model, so every measurement is inconclusive.',
      suggestedAction:
        'Repair the execution-runtime component: restore model/API access, or bias the ' +
        'rotation to no-model-call candidates that still yield a real measurement.',
    };
  }
  if (signals.duplicateDirections.length > 0) {
    const [first] = signals.duplicateDirections;
    return {
      component: 'context-memory',
      trigger: 'duplicateDirections',
      rationale:
        `The direction "${first}" has recurred at least three times — the harness keeps ` +
        're-proposing an exhausted line the ledger already records.',
      suggestedAction:
        'Feed the exhausted direction back into the context-memory component: exclude it ' +
        'from research seeds so the search moves to unexplored surfaces.',
    };
  }
  return null;
}

/** Verdict distribution over a ledger — used by the TUI and dashboard. */
export function verdictStats(rows: LedgerRow[]): Record<string, number> {
  const stats: Record<string, number> = { ACCEPT: 0, REJECT: 0, INCONCLUSIVE: 0, other: 0 };
  for (const r of rows) {
    if (r.verdict in stats) stats[r.verdict] += 1;
    else stats.other += 1;
  }
  return stats;
}
