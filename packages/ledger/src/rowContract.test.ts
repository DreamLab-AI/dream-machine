import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LEDGER_VERDICTS,
  NIGHT_VERDICTS,
  NON_NIGHT_VERDICTS,
  parseRow,
  validateLedger,
  validateRow,
} from "./rowContract";

const ENFORCE_FROM = "2026-09-06";

function rulesOf(cells: string[]): string[] {
  return validateRow(cells, ENFORCE_FROM).map((v) => v.rule);
}

const COMPLIANT = [
  "2026-09-06",
  "ledger-signals",
  "row-contract validator added; prior rows show format drift",
  "NONE",
  "pending",
  "yes",
  "ACCEPT",
  "guards cross-night memory",
  "0123456789ab",
  "",
];

describe("rowContract unit rules", () => {
  it("accepts a compliant row", () => {
    expect(rulesOf(COMPLIANT)).toEqual([]);
  });

  it("rejects pointer-only findings", () => {
    const cells = [...COMPLIANT];
    cells[2] = "INCONCLUSIVE — see report";
    expect(rulesOf(cells)).toContain("finding-pointer");
  });

  it("rejects frozen-hypothesis leakage into the finding column", () => {
    const cells = [...COMPLIANT];
    cells[2] = "Given the Darwin evaluator at commit `7c30573a2d73c8fa4c67a43042d7c0b204eefa13`";
    expect(rulesOf(cells)).toContain("finding-hypothesis-leak");
  });

  it("rejects findings longer than 80 chars", () => {
    const cells = [...COMPLIANT];
    cells[2] = "x".repeat(81);
    expect(rulesOf(cells)).toContain("finding-too-long");
  });

  it("rejects ACCEPT rows that do not track a PR", () => {
    const cells = [...COMPLIANT];
    cells[4] = "NONE";
    expect(rulesOf(cells)).toContain("accept-without-pr");
  });

  it("rejects prose in the prior-night fates column", () => {
    const cells = [...COMPLIANT];
    cells[9] = "merged #7 by human";
    expect(rulesOf(cells)).toContain("fates-grammar");
  });

  it("accepts well-formed fate tokens", () => {
    const cells = [...COMPLIANT];
    cells[9] = "#7:MERGED #8:OPEN #9:STALE";
    expect(rulesOf(cells)).toEqual([]);
  });

  // Verdict vocabulary. The three night outcomes are the ADR-0001 invariant; the
  // non-night tokens exist because the engine's dry streak counts INCONCLUSIVE and
  // ignores everything else, so filing an operator handoff or an environment block
  // as INCONCLUSIVE parks the repo on the strength of work nobody attempted.
  it.each([...NIGHT_VERDICTS])("accepts the night verdict %s", (verdict) => {
    const cells = [...COMPLIANT];
    cells[6] = verdict;
    // ACCEPT is the only token that additionally requires a PR and a witness,
    // both of which COMPLIANT already carries.
    expect(rulesOf(cells)).toEqual([]);
  });

  it.each([...NON_NIGHT_VERDICTS])("accepts the non-night verdict %s", (verdict) => {
    const cells = [...COMPLIANT];
    cells[6] = verdict;
    cells[5] = "n/a";
    expect(rulesOf(cells)).toEqual([]);
  });

  it("still rejects a verdict outside the vocabulary", () => {
    const cells = [...COMPLIANT];
    cells[6] = "MAYBE";
    expect(rulesOf(cells)).toContain("verdict-vocab");
  });

  it("does not let a non-night verdict borrow the ACCEPT-only rules", () => {
    // OPERATOR rows legitimately carry no PR and no witness; only ACCEPT is held
    // to those, so widening the vocabulary must not widen those two rules.
    const cells = [...COMPLIANT];
    cells[6] = "OPERATOR";
    cells[4] = "NONE";
    cells[8] = "";
    const rules = rulesOf(cells);
    expect(rules).not.toContain("accept-without-pr");
    expect(rules).not.toContain("accept-without-witness");
  });

  it("keeps the night and non-night vocabularies disjoint", () => {
    // A token in both sets would make the dry-streak distinction meaningless.
    const overlap = NIGHT_VERDICTS.filter((v) => (NON_NIGHT_VERDICTS as readonly string[]).includes(v));
    expect(overlap).toEqual([]);
    expect(LEDGER_VERDICTS).toHaveLength(NIGHT_VERDICTS.length + NON_NIGHT_VERDICTS.length);
  });

  it("grandfathers rows dated before the enforcement cutoff", () => {
    const cells = [...COMPLIANT];
    cells[0] = "2026-09-01";
    cells[2] = "INCONCLUSIVE — see report";
    expect(rulesOf(cells)).toEqual([]);
  });

  it("parses header and separator lines without flagging them", () => {
    const text = [
      "| date | deep | finding | issue | PR | evaluated? | verdict | effect | witness | prior-night fates |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
      "| " + COMPLIANT.join(" | ") + " |",
    ].join("\n");
    expect(validateLedger(text, ENFORCE_FROM)).toEqual([]);
    expect(parseRow(text.split("\n")[0] ?? "")).toEqual([
      "date",
      "deep",
      "finding",
      "issue",
      "PR",
      "evaluated?",
      "verdict",
      "effect",
      "witness",
      "prior-night fates",
    ]);
  });

  it("keeps cell alignment when a finding carries an escaped pipe", () => {
    const text =
      "| " +
      [...COMPLIANT].map((c, i) => (i === 2 ? "found a \\| b drift" : c)).join(" | ") +
      " |";
    expect(validateLedger(text, ENFORCE_FROM)).toEqual([]);
  });
});

describe("rowContract on the real ledger", () => {
  const ledgerPath = findLedger();

  it.skipIf(ledgerPath === null)("docs/dream-cycle/LEDGER.md complies from the cutoff", () => {
    const text = readFileSync(ledgerPath as string, "utf8");
    expect(validateLedger(text, ENFORCE_FROM)).toEqual([]);
  });
});

function findLedger(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    const candidate = join(dir, "docs", "dream-cycle", "LEDGER.md");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}
