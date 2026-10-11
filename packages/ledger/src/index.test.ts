import { describe, it, expect } from 'vitest';
import {
  emptyLedger,
  parseLedger,
  appendRow,
  renderRow,
  verifyLedger,
  learningSignals,
  parsePriorFates,
  proposeHarnessChange,
  HARNESS_COMPONENTS,
  verdictStats,
  escapeCell,
  LEDGER_COLUMNS,
  type LedgerRow,
  type LearningSignals,
} from './index.js';

function row(over: Partial<LedgerRow> = {}): LedgerRow {
  return {
    date: '2026-08-13',
    deep: 'security-adversarial',
    finding: 'add indirect prompt injection family',
    issue: '#180',
    pr: '#181',
    evaluated: 'yes',
    verdict: 'ACCEPT',
    effect: 'n=6',
    witness: '398c71a6',
    priorFates: 'first night',
    ...over,
  };
}

describe('ledger round-trip', () => {
  it('empty ledger has the 10-column header + divider', () => {
    const l = emptyLedger();
    expect(l).toContain('| Date |');
    expect(l).toContain('Prior-night fates');
    expect(LEDGER_COLUMNS).toHaveLength(10);
    expect(parseLedger(l).rows).toHaveLength(0);
  });

  it('append then parse recovers the row', () => {
    const l = appendRow(emptyLedger(), row());
    const { rows, warnings } = parseLedger(l);
    expect(warnings).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0].verdict).toBe('ACCEPT');
    expect(rows[0].finding).toBe('add indirect prompt injection family');
  });

  it('append adds EXACTLY one row and keeps the schema (property)', () => {
    let l = emptyLedger();
    for (let i = 0; i < 25; i++) {
      const before = parseLedger(l).rows.length;
      l = appendRow(l, row({ date: `2026-08-${String((i % 28) + 1).padStart(2, '0')}` }));
      const after = parseLedger(l).rows.length;
      expect(after).toBe(before + 1);
    }
    expect(parseLedger(l).rows).toHaveLength(25);
    // Header still intact and unique.
    expect((l.match(/\| Date \|/g) ?? []).length).toBe(1);
  });

  it('appends to a ledger that had no trailing newline', () => {
    const l = appendRow('| Date | Deep | Finding | Issue | PR | Evaluated? | Verdict | Effect | Witness | Prior-night fates |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |', row());
    expect(parseLedger(l).rows).toHaveLength(1);
  });

  it('bootstraps a header when appending to empty string', () => {
    const l = appendRow('', row());
    expect(l).toContain('| Date |');
    expect(parseLedger(l).rows).toHaveLength(1);
  });
});

describe('cell escaping', () => {
  it('escapes pipes and newlines so a row cannot break the table', () => {
    const l = appendRow(emptyLedger(), row({ finding: 'a | b\nc' }));
    expect(parseLedger(l).rows).toHaveLength(1);
    expect(renderRow(row({ finding: 'a | b' }))).toContain('a \\| b');
    expect(escapeCell('x\ny')).toBe('x y');
  });

  it('round-trips an escaped pipe instead of shifting the later cells', () => {
    const l = appendRow(emptyLedger(), row({ finding: 'found a | b drift' }));
    const { rows, warnings } = parseLedger(l);
    expect(warnings).toEqual([]);
    expect(rows[0].finding).toBe('found a | b drift');
    expect(rows[0].verdict).toBe('ACCEPT');
    expect(rows[0].priorFates).toBe('first night');
  });

  it('verifyLedger accepts a row whose escaped pipe renderRow itself wrote', () => {
    const r = verifyLedger(appendRow(emptyLedger(), row({ finding: 'a | b' })));
    expect(r.ok).toBe(true);
  });
});

describe('verifyLedger', () => {
  it('accepts a valid ledger', () => {
    const l = appendRow(appendRow(emptyLedger(), row()), row({ date: '2026-08-14', verdict: 'REJECT' }));
    const r = verifyLedger(l);
    expect(r.ok).toBe(true);
    expect(r.rowCount).toBe(2);
  });

  it('flags an out-of-range verdict', () => {
    const l = appendRow(emptyLedger(), row({ verdict: 'MAYBE' }));
    const r = verifyLedger(l);
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/verdict/);
  });

  it('flags a bad date and bad evaluated value', () => {
    const l = appendRow(emptyLedger(), row({ date: 'yesterday', evaluated: 'perhaps' }));
    const r = verifyLedger(l);
    expect(r.errors.join()).toMatch(/date/);
    expect(r.errors.join()).toMatch(/evaluated/);
  });

  it('accepts the non-night verdicts and an n/a evaluated column', () => {
    // Regression: verifyLedger gated on its own copy of the vocabulary, so an
    // operator row (verdict OPERATOR, evaluated n/a) passed the row contract and
    // was then rejected here. Both now read the same constants from rowContract.
    let l = emptyLedger();
    l = appendRow(l, row({ date: '2026-09-07', verdict: 'OPERATOR', evaluated: 'n/a' }));
    l = appendRow(l, row({ date: '2026-09-08', verdict: 'HANDOFF', evaluated: 'n/a' }));
    l = appendRow(l, row({ date: '2026-09-09', verdict: 'BLOCKED-ENV', evaluated: 'blocked' }));
    const r = verifyLedger(l);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.rowCount).toBe(3);
  });

  it('flags a missing header', () => {
    const r = verifyLedger('just some text, no table');
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/header/);
  });
});

describe('learning signals', () => {
  it('detects a zero-merge streak when no PR is known-merged', () => {
    let l = emptyLedger();
    for (let i = 0; i < 14; i++) l = appendRow(l, row({ pr: `#${100 + i}`, verdict: 'INCONCLUSIVE' }));
    const { rows } = parseLedger(l);
    const s = learningSignals(rows, { mergedPrNumbers: new Set() });
    expect(s.zeroMergeStreak).toBe(true);
  });

  it('clears the zero-merge streak when a PR merged', () => {
    let l = emptyLedger();
    for (let i = 0; i < 14; i++) l = appendRow(l, row({ pr: `#${100 + i}` }));
    const { rows } = parseLedger(l);
    const s = learningSignals(rows, { mergedPrNumbers: new Set(['105']) });
    expect(s.zeroMergeStreak).toBe(false);
  });

  it('clears the zero-merge streak from a #N:MERGED token in Prior-night fates, with no explicit option', () => {
    let l = emptyLedger();
    for (let i = 0; i < 13; i++) l = appendRow(l, row({ pr: `#${100 + i}`, priorFates: 'no news' }));
    l = appendRow(l, row({ pr: '#113', priorFates: 'checked last week: #105:MERGED, #108:CLOSED' }));
    const { rows } = parseLedger(l);
    const s = learningSignals(rows);
    expect(s.zeroMergeStreak).toBe(false);
  });

  it('does not clear the streak for CLOSED/OPEN/STALE fate tokens', () => {
    let l = emptyLedger();
    for (let i = 0; i < 14; i++) {
      l = appendRow(l, row({ pr: `#${100 + i}`, priorFates: `#${99 + i}:CLOSED` }));
    }
    const { rows } = parseLedger(l);
    expect(learningSignals(rows).zeroMergeStreak).toBe(true);
  });

  it('ignores free prose in Prior-night fates (only the explicit #N:FATE token counts)', () => {
    let l = emptyLedger();
    for (let i = 0; i < 14; i++) {
      l = appendRow(l, row({ pr: `#${100 + i}`, priorFates: 'PR 105 was merged into main yesterday' }));
    }
    const { rows } = parseLedger(l);
    expect(learningSignals(rows).zeroMergeStreak).toBe(true);
  });

  it('parsePriorFates keeps the latest fate when a PR is mentioned more than once', () => {
    const rows = [
      row({ priorFates: '#105:OPEN' }),
      row({ priorFates: '#105:MERGED' }),
    ];
    expect(parsePriorFates(rows).get('105')).toBe('MERGED');
  });

  it('detects duplicate directions repeated >= 3 times', () => {
    let l = emptyLedger();
    for (let i = 0; i < 3; i++) l = appendRow(l, row({ finding: 'improve router calibration loop' }));
    l = appendRow(l, row({ finding: 'totally different thing here' }));
    const { rows } = parseLedger(l);
    const s = learningSignals(rows);
    expect(s.duplicateDirections.some((d) => d.includes('router'))).toBe(true);
  });

  it('detects a low-score streak (last 3 < 5)', () => {
    const { rows } = parseLedger(appendRow(emptyLedger(), row()));
    expect(learningSignals(rows, { recentScores: [7, 4, 3, 2] }).lowScoreStreak).toBe(true);
    expect(learningSignals(rows, { recentScores: [7, 4, 6] }).lowScoreStreak).toBe(false);
  });

  it('detects a blocked-eval streak', () => {
    let l = emptyLedger();
    for (let i = 0; i < 5; i++) l = appendRow(l, row({ evaluated: 'blocked', verdict: 'INCONCLUSIVE' }));
    const { rows } = parseLedger(l);
    expect(learningSignals(rows).blockedEvalStreak).toBe(true);
  });
});

describe('proposeHarnessChange', () => {
  function signals(over: Partial<LearningSignals> = {}): LearningSignals {
    return {
      zeroMergeStreak: false,
      duplicateDirections: [],
      lowScoreStreak: false,
      blockedEvalStreak: false,
      nightsConsidered: 5,
      ...over,
    };
  }

  it('returns null when no signal fires', () => {
    expect(proposeHarnessChange(signals())).toBeNull();
  });

  it('maps zeroMergeStreak → orchestration', () => {
    const p = proposeHarnessChange(signals({ zeroMergeStreak: true }));
    expect(p).toMatchObject({ component: 'orchestration', trigger: 'zeroMergeStreak' });
    expect(p!.rationale).toContain('5'); // nightsConsidered surfaced in the rationale
  });

  it('maps lowScoreStreak → evaluation-feedback', () => {
    expect(proposeHarnessChange(signals({ lowScoreStreak: true }))).toMatchObject({
      component: 'evaluation-feedback',
      trigger: 'lowScoreStreak',
    });
  });

  it('maps blockedEvalStreak → execution-runtime', () => {
    expect(proposeHarnessChange(signals({ blockedEvalStreak: true }))).toMatchObject({
      component: 'execution-runtime',
      trigger: 'blockedEvalStreak',
    });
  });

  it('maps duplicateDirections → context-memory and names the direction', () => {
    const p = proposeHarnessChange(signals({ duplicateDirections: ['router turn credit'] }));
    expect(p).toMatchObject({ component: 'context-memory', trigger: 'duplicateDirections' });
    expect(p!.rationale).toContain('router turn credit');
  });

  it('proposes exactly one component in strict severity order', () => {
    // All four signals firing at once → zeroMergeStreak wins (most existential).
    const all = signals({
      zeroMergeStreak: true,
      lowScoreStreak: true,
      blockedEvalStreak: true,
      duplicateDirections: ['x y z'],
    });
    expect(proposeHarnessChange(all)!.trigger).toBe('zeroMergeStreak');
    // Next tier: lowScore beats blockedEval + duplicate.
    expect(
      proposeHarnessChange(
        signals({ lowScoreStreak: true, blockedEvalStreak: true, duplicateDirections: ['x y z'] }),
      )!.trigger,
    ).toBe('lowScoreStreak');
    // Then blockedEval beats duplicate.
    expect(
      proposeHarnessChange(signals({ blockedEvalStreak: true, duplicateDirections: ['x y z'] }))!
        .trigger,
    ).toBe('blockedEvalStreak');
  });

  it('every proposal targets a known harness component with non-empty guidance', () => {
    const each: Partial<LearningSignals>[] = [
      { zeroMergeStreak: true },
      { lowScoreStreak: true },
      { blockedEvalStreak: true },
      { duplicateDirections: ['a b c'] },
    ];
    for (const s of each) {
      const p = proposeHarnessChange(signals(s))!;
      expect(HARNESS_COMPONENTS).toContain(p.component);
      expect(p.rationale.length).toBeGreaterThan(0);
      expect(p.suggestedAction.length).toBeGreaterThan(0);
    }
  });

  it('exposes five unique harness components', () => {
    expect(HARNESS_COMPONENTS).toHaveLength(5);
    expect(new Set(HARNESS_COMPONENTS).size).toBe(5);
  });
});

describe('verdictStats', () => {
  it('counts verdicts', () => {
    let l = emptyLedger();
    l = appendRow(l, row({ verdict: 'ACCEPT' }));
    l = appendRow(l, row({ verdict: 'REJECT' }));
    l = appendRow(l, row({ verdict: 'INCONCLUSIVE' }));
    l = appendRow(l, row({ verdict: 'INCONCLUSIVE' }));
    const s = verdictStats(parseLedger(l).rows);
    expect(s).toEqual({ ACCEPT: 1, REJECT: 1, INCONCLUSIVE: 2, other: 0 });
  });
});
