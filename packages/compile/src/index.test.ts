import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile, validateConfig, defaultConfig, withDefaults, type DreamConfig } from './index.js';

const metaharness: DreamConfig = {
  repo: 'ruvnet/metaharness',
  cron: '0 8 * * *',
  slots: [
    { deep: 'generator-genome', scan: ['router', 'turn-credit'] },
    { deep: 'flywheel-promotion', scan: ['evals-verticals', 'bench'] },
    { deep: 'darwin-evolution', scan: ['weight-eft', 'learn'] },
    { deep: 'security-adversarial', scan: ['sbom', 'policy'] },
    { deep: 'host-adapters', scan: ['kernel', 'sdk'] },
  ],
  bonusModuli: { '25': 'vertical-packs', '75': 'meta-proxy' },
  buildStep: { cmd: 'npm ci && npm run build', degradeOnWasmFailure: true },
  evaluatorEntrypoints: { bench: 'experiments/*/run.mjs' },
  adrConvention: '3-digit',
  competitors: ['LangGraph', 'AutoGen', 'DSPy/GEPA', 'SWE-bench derivatives'],
  extraDisciplines: ['adr-250-proof-ladder'],
};

describe('validateConfig', () => {
  it('accepts a well-formed config', () => {
    expect(validateConfig(metaharness).ok).toBe(true);
  });
  it('rejects a bad repo', () => {
    expect(validateConfig({ ...metaharness, repo: 'nope' }).ok).toBe(false);
  });
  it('rejects a bad cron', () => {
    expect(validateConfig({ ...metaharness, cron: 'nightly' }).ok).toBe(false);
  });
  it('rejects schedules more frequent than hourly', () => {
    for (const cron of ['* * * * *', '*/5 * * * *', '0,30 * * * *', '60 * * * *']) {
      const result = validateConfig({ ...metaharness, cron });
      expect(result.ok).toBe(false);
      expect(result.errors.join()).toMatch(/minimum interval is 1 hour/);
    }
  });
  it('accepts a fixed minute with an hourly or slower cadence', () => {
    expect(validateConfig({ ...metaharness, cron: '15 */2 * * *' }).ok).toBe(true);
  });
  it('rejects empty slots', () => {
    const r = validateConfig({ ...metaharness, slots: [] });
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/slot/);
  });
  it('rejects blank or non-string slot deeps and scan surface names', () => {
    const badSlots = [
      { deep: '   ', scan: ['router', 'turn-credit'] },
      { deep: 'generator-genome', scan: ['router', '   '] },
      { deep: 'generator-genome', scan: [42, 'turn-credit'] },
      { deep: 'generator-genome', scan: 'router,turn-credit' },
    ] as unknown as DreamConfig['slots'];
    for (const slot of badSlots) {
      const r = validateConfig({ ...metaharness, slots: [slot] });
      expect(r.ok).toBe(false);
      expect(r.errors.join()).toMatch(/slot 0/);
    }
  });
  it('still warns, not errors, on an absent scan list', () => {
    const r = validateConfig({
      ...metaharness,
      slots: [{ deep: 'generator-genome' }],
    } as unknown as DreamConfig);
    expect(r.ok).toBe(true);
    expect(r.warnings.join()).toMatch(/no scan surfaces/);
  });
  it('rejects a blank or non-string bonusModuli surface name', () => {
    for (const bonusModuli of [{ 25: '' }, { 25: 7 }]) {
      const r = validateConfig({
        ...metaharness,
        bonusModuli,
      } as unknown as DreamConfig);
      expect(r.ok).toBe(false);
      expect(r.errors.join()).toMatch(/bonusModuli key "25"/);
    }
  });
  it('rejects a non-integer bonus modulus key', () => {
    expect(validateConfig({ ...metaharness, bonusModuli: { x: 'y' } }).ok).toBe(false);
  });
  it('rejects a malformed adrConvention instead of corrupting STEP 19 paths', () => {
    const bad = [
      '5-digit',
      42,
      null,
      { pad: 0, dir: 'docs/adrs' },
      { pad: 1.5, dir: 'docs/adrs' },
      { pad: 4, dir: '' },
      { pad: 4 },
    ] as unknown as DreamConfig['adrConvention'][];
    for (const conv of bad) {
      const r = validateConfig({ ...metaharness, adrConvention: conv });
      expect(r.ok).toBe(false);
      expect(r.errors.join()).toMatch(/adrConvention/);
    }
  });
  it('accepts "3-digit", "4-digit" and a well-formed { pad, dir } object', () => {
    expect(validateConfig(metaharness).ok).toBe(true); // '3-digit'
    expect(validateConfig({ ...metaharness, adrConvention: '4-digit' }).ok).toBe(true);
    expect(
      validateConfig({ ...metaharness, adrConvention: { pad: 3, dir: 'docs/decisions' } }).ok,
    ).toBe(true);
  });
});

describe('compile', () => {
  const prompt = compile(metaharness);

  it('throws on an invalid config', () => {
    expect(() => compile({ ...metaharness, repo: '' })).toThrow(/invalid dream.config/);
  });

  it('is deterministic (same input → identical output)', () => {
    expect(compile(metaharness)).toBe(prompt);
  });

  it('injects the target repo everywhere it matters', () => {
    expect(prompt).toContain('ruvnet/metaharness');
    expect(prompt).toContain('cron `0 8 * * *`');
  });

  it('contains every rotation slot and its scans', () => {
    for (const s of metaharness.slots) {
      expect(prompt).toContain(`DEEP=${s.deep}`);
      expect(prompt).toContain((s.scan as string[]).join(','));
    }
    expect(prompt).toContain('SLOT=$(( DAYINT % 5 ))');
  });

  it('injects bonus moduli', () => {
    expect(prompt).toContain('DAYINT % 25 == 0');
    expect(prompt).toContain('vertical-packs');
  });

  it('injects competitors, build step, evaluator, extra discipline', () => {
    expect(prompt).toContain('DSPy/GEPA');
    expect(prompt).toContain('npm ci && npm run build');
    expect(prompt).toContain('experiments/*/run.mjs');
    expect(prompt).toContain('adr-250-proof-ladder');
  });

  it('uses the 3-digit ADR convention when configured', () => {
    expect(prompt).toContain('ADR-00N'); // pad 3 → two zeros + N
    expect(prompt).toContain('3-digit padding');
  });

  it('carries the load-bearing invariants verbatim', () => {
    expect(prompt).toContain('ACCEPT | REJECT | INCONCLUSIVE');
    expect(prompt).toContain('evaluation is not promotion');
    expect(prompt).toContain('never self-merges');
    expect(prompt).toMatch(/WITNESS=\$\(printf/);
    expect(prompt).toContain('| Date | Deep | Finding | Issue | PR | Evaluated? | Verdict | Effect | Witness | Prior-night fates |');
  });

  it('contains every pipeline step marker', () => {
    for (const marker of ['STEP 0:', 'STEP 0.5', 'STEP 0.6', 'STEP 1:', 'STEP 1.1', 'STEP 2:', 'STEP 3:', 'STEP 5–9', 'STEP 10–14', 'STEP 15', 'STEP 16', 'STEP 17', 'STEP 19', 'STEP 20', 'STEP 26', 'STOP CONDITIONS', 'FINAL REPORT', 'FINAL OPERATING PRINCIPLE']) {
      expect(prompt).toContain(marker);
    }
  });

  it('describes human-review-only merge policy by default', () => {
    expect(prompt).toContain('Human review required');
    expect(prompt).not.toContain('guarded auto-merge ENABLED');
  });

  it('describes GUARDED auto-merge only when enabled', () => {
    const p = compile({ ...metaharness, autoMerge: true });
    expect(p).toContain('guarded auto-merge ENABLED');
    expect(p).toContain('explicit low-risk label');
    // Even with auto-merge, the session itself never merges.
    expect(p).toContain('session itself still never runs the merge');
  });

  it('emits a 4-digit ADR example for a default config', () => {
    const p = compile(defaultConfig('acme/widget'));
    expect(p).toContain('ADR-000N');
    expect(p).toContain('4-digit padding');
  });

  it('golden-snapshot: metaharness prompt is stable', () => {
    expect(prompt).toMatchSnapshot();
  });
});

describe('defaults', () => {
  it('withDefaults fills ledger path, branch prefix, labels', () => {
    const c = withDefaults(defaultConfig('a/b'));
    expect(c.ledgerPath).toBe('docs/dream-cycle/LEDGER.md');
    expect(c.branchPrefix).toBe('dream/');
    expect(c.labels).toContain('dream-cycle');
  });
});

// This repo self-hosts: its own dream.config.json is what STEP B of every
// nightly run actually compiles. Every other test above exercises a
// synthetic fixture — none of them would catch a regression that broke this
// repo's real, committed config. Read it the same way `dream-machine compile
// dream.config.json` does, and golden-snapshot it.
describe('self-hosted config (DreamLab-AI/dream-engine fork)', () => {
  const selfConfig: DreamConfig = JSON.parse(
    readFileSync(join(process.cwd(), 'dream.config.json'), 'utf8'),
  );

  it('validates', () => {
    expect(validateConfig(selfConfig).ok).toBe(true);
  });

  it('resolves autoMerge: false (fork policy: human merge gate, no auto-merge)', () => {
    expect(withDefaults(selfConfig).autoMerge).toBe(false);
  });

  it('compiles deterministically', () => {
    expect(compile(selfConfig)).toBe(compile(selfConfig));
  });

  it('golden-snapshot: DreamLab-AI/dream-engine prompt is stable', () => {
    expect(compile(selfConfig)).toMatchSnapshot();
  });

  // Supply-chain regression guard (scans: redblue, supply-chain). The
  // pinned-evaluator-entrypoints discipline is prose until a test fails: an
  // unpinned npx @metaharness/darwin executes whatever the registry resolves
  // that night. Every darwin mention in the self-hosted compiled prompt must
  // be an exact semver pin, and all mentions must agree on one version, so an
  // unpin, a range, or an unrecorded bump fails bench.
  it('compiles the nightly prompt with darwin pinned to exactly one version', () => {
    const prompt = compile(selfConfig);
    const mentions = prompt.match(/@metaharness\/darwin(?:@[\w.-]+)?/g) ?? [];
    expect(mentions.length).toBeGreaterThan(0);
    const pins = mentions.filter((m) => /^@metaharness\/darwin@\d+\.\d+\.\d+$/.test(m));
    expect(pins).toHaveLength(mentions.length);
    expect(new Set(pins).size).toBe(1);
  });

  // ADR-0005 lever E wiring: the darwin evaluator must run through the
  // checked-in entrypoint script, which wraps the run in verify-entrypoint
  // (bounds, ADR-0006/0007 uniformity) and the loom shim. The pin test above
  // catches an unpin; nothing else catches unwrapping the pinned command.
  it('routes the darwin evaluator through scripts/darwin-entrypoint.sh', () => {
    const prompt = compile(selfConfig);
    expect(prompt).toContain('./scripts/darwin-entrypoint.sh npx @metaharness/darwin@');
    expect(prompt).toContain('--sandbox mock');
  });
});
