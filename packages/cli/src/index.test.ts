import { describe, it, expect } from 'vitest';
import { run, parseArgs, VERSION, type IO } from './index.js';
import { renderDashboard } from './tui.js';
import { appendRow, emptyLedger, type LedgerRow } from '@dream-machine/ledger';
import { stamp } from '@dream-machine/witness';

function mockIO(files: Record<string, string> = {}): IO & { files: Record<string, string> } {
  const store = { ...files };
  return {
    files: store,
    readFile: async (p) => {
      if (!(p in store)) throw new Error(`ENOENT ${p}`);
      return store[p];
    },
    writeFile: async (p, c) => {
      store[p] = c;
    },
    now: () => '2026-08-13',
    env: {},
  };
}

const sampleRow = (o: Partial<LedgerRow> = {}): LedgerRow => ({
  date: '2026-08-13',
  deep: 'security-adversarial',
  finding: 'add indirect prompt injection',
  issue: '#180',
  pr: '#181',
  evaluated: 'yes',
  verdict: 'ACCEPT',
  effect: 'n=6',
  witness: '398c71a6',
  priorFates: '-',
  ...o,
});

describe('parseArgs', () => {
  it('parses positionals, --k v, --k=v, and bare flags', () => {
    const { _, flags } = parseArgs(['compile', 'a.json', '--out', 'x.md', '--env=e1', '--no-color']);
    expect(_).toEqual(['compile', 'a.json']);
    expect(flags.out).toBe('x.md');
    expect(flags.env).toBe('e1');
    expect(flags['no-color']).toBe(true);
  });
});

describe('help / version', () => {
  it('help with no args', async () => {
    const r = await run([], mockIO());
    expect(r.code).toBe(0);
    expect(r.out).toContain('dream-machine');
    expect(r.out).toContain('never merges');
  });
  it('version', async () => {
    const r = await run(['version'], mockIO());
    expect(r.out.trim()).toBe(VERSION);
  });
  it('unknown command exits 1', async () => {
    const r = await run(['frobnicate'], mockIO());
    expect(r.code).toBe(1);
    expect(r.err).toContain('unknown command');
  });
});

describe('init', () => {
  it('prints a config to stdout', async () => {
    const r = await run(['init', '--repo', 'acme/widget'], mockIO());
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out).repo).toBe('acme/widget');
  });
  it('writes a config file', async () => {
    const io = mockIO();
    const r = await run(['init', '--repo', 'acme/widget', '--out', 'dream.config.json'], io);
    expect(r.code).toBe(0);
    expect(JSON.parse(io.files['dream.config.json']).repo).toBe('acme/widget');
  });
});

describe('compile', () => {
  it('compiles a config to a prompt', async () => {
    const io = mockIO();
    await run(['init', '--repo', 'acme/widget', '--out', 'c.json'], io);
    const r = await run(['compile', 'c.json'], io);
    expect(r.code).toBe(0);
    expect(r.out).toContain('nightly routine for `acme/widget`');
  });
  it('writes compiled prompt to --out', async () => {
    const io = mockIO();
    await run(['init', '--repo', 'a/b', '--out', 'c.json'], io);
    const r = await run(['compile', 'c.json', '--out', 'PROMPT.md'], io);
    expect(r.code).toBe(0);
    expect(io.files['PROMPT.md']).toContain('GLOBAL INVARIANTS');
  });
  it('rejects an invalid config', async () => {
    const io = mockIO({ 'bad.json': JSON.stringify({ repo: 'nope' }) });
    const r = await run(['compile', 'bad.json'], io);
    expect(r.code).toBe(1);
    expect(r.err).toContain('invalid config');
  });
});

describe('schedule', () => {
  it('emits routine JSON', async () => {
    const io = mockIO();
    await run(['init', '--repo', 'a/b', '--out', 'c.json'], io);
    const r = await run(['schedule', 'c.json', '--env', 'env_1'], io);
    expect(r.code).toBe(0);
    const body = JSON.parse(r.out);
    expect(body.job_config.ccr.environment_id).toBe('env_1');
  });
});

describe('ledger', () => {
  const ledgerMd = appendRow(appendRow(emptyLedger(), sampleRow()), sampleRow({ date: '2026-08-14', verdict: 'REJECT' }));

  it('verify OK', async () => {
    const r = await run(['ledger', 'verify', '--path', 'L.md'], mockIO({ 'L.md': ledgerMd }));
    expect(r.code).toBe(0);
    expect(r.out).toContain('ledger OK');
  });
  it('verify flags a bad verdict', async () => {
    const bad = appendRow(emptyLedger(), sampleRow({ verdict: 'MAYBE' }));
    const r = await run(['ledger', 'verify', '--path', 'L.md'], mockIO({ 'L.md': bad }));
    expect(r.code).toBe(1);
    expect(r.err).toContain('verdict');
  });
  it('stats', async () => {
    const r = await run(['ledger', 'stats', '--path', 'L.md'], mockIO({ 'L.md': ledgerMd }));
    expect(JSON.parse(r.out).ACCEPT).toBe(1);
    expect(JSON.parse(r.out).REJECT).toBe(1);
  });
  it('signals', async () => {
    const r = await run(['ledger', 'signals', '--path', 'L.md'], mockIO({ 'L.md': ledgerMd }));
    expect(JSON.parse(r.out)).toHaveProperty('zeroMergeStreak');
  });
  it('signals defaults zeroMergeStreak to worst-case true without --merged, even for a real PR', async () => {
    const r = await run(['ledger', 'signals', '--path', 'L.md'], mockIO({ 'L.md': ledgerMd }));
    expect(JSON.parse(r.out).zeroMergeStreak).toBe(true);
  });
  it('signals reports zeroMergeStreak=false once --merged names the row\'s PR', async () => {
    const r = await run(['ledger', 'signals', '--path', 'L.md', '--merged', '181'], mockIO({ 'L.md': ledgerMd }));
    expect(JSON.parse(r.out).zeroMergeStreak).toBe(false);
  });
  it('signals --merged tolerates a leading # and surrounding whitespace in the CSV', async () => {
    const r = await run(['ledger', 'signals', '--path', 'L.md', '--merged', ' #181 , 999'], mockIO({ 'L.md': ledgerMd }));
    expect(JSON.parse(r.out).zeroMergeStreak).toBe(false);
  });
  it('signals --merged naming an unrelated PR leaves zeroMergeStreak true', async () => {
    const r = await run(['ledger', 'signals', '--path', 'L.md', '--merged', '999'], mockIO({ 'L.md': ledgerMd }));
    expect(JSON.parse(r.out).zeroMergeStreak).toBe(true);
  });
  it('signals rejects a value-less --merged with a clear usage error, not a crash', async () => {
    const r = await run(['ledger', 'signals', '--path', 'L.md', '--merged'], mockIO({ 'L.md': ledgerMd }));
    expect(r.code).toBe(1);
    expect(r.err).toContain('--merged expects a comma-separated PR number list');
    expect(r.err).not.toContain('is not a function');
  });
  it('signals without --propose stays backward-compatible (bare signals object)', async () => {
    const r = await run(['ledger', 'signals', '--path', 'L.md'], mockIO({ 'L.md': ledgerMd }));
    const out = JSON.parse(r.out);
    expect(out).toHaveProperty('zeroMergeStreak');
    expect(out).not.toHaveProperty('proposal');
  });
  it('signals --propose emits {signals, proposal}; zeroMergeStreak → orchestration draft', async () => {
    const r = await run(['ledger', 'signals', '--path', 'L.md', '--propose'], mockIO({ 'L.md': ledgerMd }));
    expect(r.code).toBe(0);
    const out = JSON.parse(r.out);
    expect(out.signals).toHaveProperty('zeroMergeStreak', true);
    expect(out.proposal).toMatchObject({ component: 'orchestration', trigger: 'zeroMergeStreak' });
  });
  it('signals --propose yields proposal: null once the streak clears and no other signal fires', async () => {
    const r = await run(
      ['ledger', 'signals', '--path', 'L.md', '--merged', '181', '--propose'],
      mockIO({ 'L.md': ledgerMd }),
    );
    const out = JSON.parse(r.out);
    expect(out.signals.zeroMergeStreak).toBe(false);
    expect(out.proposal).toBeNull();
  });
  it('signals --scores makes lowScoreStreak reachable → evaluation-feedback proposal', async () => {
    // Clear the higher-priority zeroMergeStreak (--merged) so the low-score branch surfaces.
    const r = await run(
      ['ledger', 'signals', '--path', 'L.md', '--merged', '181', '--scores', '2,3,4', '--propose'],
      mockIO({ 'L.md': ledgerMd }),
    );
    const out = JSON.parse(r.out);
    expect(out.signals.lowScoreStreak).toBe(true);
    expect(out.proposal).toMatchObject({ component: 'evaluation-feedback', trigger: 'lowScoreStreak' });
  });
  it('signals --scores keeps a legitimate 0 and drops empty tokens ("0,,0,0")', async () => {
    const r = await run(
      ['ledger', 'signals', '--path', 'L.md', '--merged', '181', '--scores', '0,,0,0', '--propose'],
      mockIO({ 'L.md': ledgerMd }),
    );
    // "0,,0,0" → empties dropped, zeros kept → [0,0,0] → all three < 5 → streak true.
    // A naive filter(Boolean) would drop the zeros → [] → false, so this pins the behaviour.
    expect(JSON.parse(r.out).signals.lowScoreStreak).toBe(true);
  });
  it('signals rejects a value-less --scores with a clear usage error, not a crash', async () => {
    const r = await run(['ledger', 'signals', '--path', 'L.md', '--scores'], mockIO({ 'L.md': ledgerMd }));
    expect(r.code).toBe(1);
    expect(r.err).toContain('--scores expects a comma-separated list');
    expect(r.err).not.toContain('is not a function');
  });
  it('append writes a row (bootstraps ledger if missing)', async () => {
    const io = mockIO();
    const r = await run(
      ['ledger', 'append', '--path', 'L.md', '--deep', 'perf', '--finding', 'x', '--verdict', 'INCONCLUSIVE'],
      io,
    );
    expect(r.code).toBe(0);
    expect(io.files['L.md']).toContain('| perf |');
  });
});

describe('witness', () => {
  it('stamp prints the triple', async () => {
    const io = mockIO({ 'r.md': 'report body' });
    const r = await run(['witness', 'stamp', 'r.md', '68402755f017e0df5f493c6ee608218420540d17'], io);
    expect(r.code).toBe(0);
    expect(r.out).toContain('witness       :');
  });
  it('verify accepts a genuine stamp and rejects a forgery', async () => {
    const report = 'genuine report';
    const commit = '68402755f017e0df5f493c6ee608218420540d17';
    const w = stamp(report, commit);
    const io = mockIO({ 'r.md': report });
    const ok = await run(['witness', 'verify', 'r.md', commit, w.witness], io);
    expect(ok.code).toBe(0);
    const bad = await run(['witness', 'verify', 'r.md', commit, 'a'.repeat(64)], io);
    expect(bad.code).toBe(1);
    expect(bad.err).toContain('INVALID');
  });
});

describe('verify-entrypoint', () => {
  function mockIOWithExec(exec: IO['exec']): IO {
    return { ...mockIO(), exec };
  }

  it('reports live for a command that produces output and exits 0', async () => {
    const io = mockIOWithExec(async () => ({ code: 0, stdout: 'ok', stderr: '' }));
    const r = await run(['verify-entrypoint', 'bench', '--cmd', 'npm test'], io);
    expect(r.code).toBe(0);
    expect(r.out).toContain('bench: live');
  });

  it('reports blocked for a nonzero exit', async () => {
    const io = mockIOWithExec(async () => ({
      code: 1,
      stdout: '',
      stderr: 'npm error could not determine executable to run',
    }));
    const r = await run(['verify-entrypoint', 'flywheel', '--cmd', 'npx @metaharness/flywheel'], io);
    expect(r.code).toBe(1);
    expect(r.out).toContain('flywheel: blocked');
  });

  it('reports suspicious-silent (not live) for exit 0 with no output', async () => {
    const io = mockIOWithExec(async () => ({ code: 0, stdout: '', stderr: '' }));
    const r = await run(['verify-entrypoint', 'redblue', '--cmd', 'npx @metaharness/redblue'], io);
    expect(r.code).toBe(2);
    expect(r.out).toContain('redblue: suspicious-silent');
    expect(r.out).toContain('do not record EVALUATED=yes');
  });

  it('errors without --cmd', async () => {
    const io = mockIOWithExec(async () => ({ code: 0, stdout: '', stderr: '' }));
    const r = await run(['verify-entrypoint', 'redblue'], io);
    expect(r.code).toBe(1);
    expect(r.err).toContain('usage:');
  });

  it('rejects an unquoted multi-word --cmd instead of silently truncating it', async () => {
    // Regression test: `verify-entrypoint redblue --cmd npx @metaharness/redblue` (no
    // quotes/`=`) used to let --cmd absorb only "npx" and silently drop
    // "@metaharness/redblue" as a stray positional — running bare `npx` (which prints its
    // own usage text and exits 0) then misreported a false "live" verdict for the exact
    // silent-failure this tool exists to catch.
    const io = mockIOWithExec(async () => ({ code: 0, stdout: 'npx usage text', stderr: '' }));
    const r = await run(['verify-entrypoint', 'redblue', '--cmd', 'npx', '@metaharness/redblue'], io);
    expect(r.code).toBe(1);
    expect(r.err).toContain('unexpected extra argument');
    expect(r.out).not.toContain('live');
  });

  it('errors when the IO has no exec()', async () => {
    const r = await run(['verify-entrypoint', 'redblue', '--cmd', 'echo hi'], mockIO());
    expect(r.code).toBe(1);
    expect(r.err).toContain('no exec()');
  });

  // ADR-0003. The real 2026-09-07 REQUIRED-evaluator leaderboard (run ab4ced4e48b76e83):
  // outcome=PASSED, exit 0, and five candidates in generation 2 against the then <=4
  // bound. ADR-0005 raised the bound to 5 to match darwin@0.10.2's five-surface map, so
  // its shape is within bounds; its uniform 0.765 scores fail it under ADR-0006.
  const DARWIN_LEADERBOARD_2026_09_07 = [
    'Darwin Mode — leaderboard',
    '  0.765  baseline  [planner]  safety=1.00  pass=0.60 ◀ winner',
    '  0.765  g1_v0  [planner]  safety=1.00  pass=0.60',
    '  0.765  g1_v1  [toolPolicy]  safety=1.00  pass=0.60',
    '  0.765  g1_v2  [reviewer]  safety=1.00  pass=0.60',
    '  0.765  g1_v3  [toolPolicy]  safety=1.00  pass=0.60',
    '  0.765  g2_v0  [reviewer]  safety=1.00  pass=0.60',
    '  0.765  g2_v1  [planner]  safety=1.00  pass=0.60',
    '  0.765  g2_v2  [contextBuilder]  safety=1.00  pass=0.60',
    '  0.765  g2_v3  [toolPolicy]  safety=1.00  pass=0.60',
    '  0.765  g2_v4  [scorePolicy]  safety=1.00  pass=0.60',
    '',
    'Winner: baseline',
    'Lineage: baseline',
    'Delta over baseline: +0.000',
  ].join('\n');

  // The same 4 + 5 shape with discriminating scores: the compliant ceiling.
  const DARWIN_LEADERBOARD_VARIED = [
    'Darwin Mode — leaderboard',
    '  0.812  g2_v1  [planner]  safety=1.00  pass=0.66 ◀ winner',
    '  0.798  g2_v3  [toolPolicy]  safety=1.00  pass=0.64',
    '  0.781  g1_v0  [planner]  safety=1.00  pass=0.62',
    '  0.774  g2_v0  [reviewer]  safety=1.00  pass=0.61',
    '  0.765  baseline  [planner]  safety=1.00  pass=0.60',
    '  0.765  g1_v2  [reviewer]  safety=1.00  pass=0.60',
    '  0.752  g1_v1  [toolPolicy]  safety=1.00  pass=0.58',
    '  0.749  g2_v2  [contextBuilder]  safety=1.00  pass=0.58',
    '  0.741  g1_v3  [toolPolicy]  safety=1.00  pass=0.57',
    '  0.733  g2_v4  [scorePolicy]  safety=1.00  pass=0.56',
    '',
    'Winner: g2_v1',
    'Lineage: baseline → g1_v0 → g2_v1',
    'Delta over baseline: +0.047',
  ].join('\n');

  const DARWIN_LEADERBOARD_SIX_IN_G2 = DARWIN_LEADERBOARD_VARIED.replace(
    '  0.733  g2_v4  [scorePolicy]  safety=1.00  pass=0.56',
    [
      '  0.733  g2_v4  [scorePolicy]  safety=1.00  pass=0.56',
      '  0.728  g2_v5  [planner]  safety=1.00  pass=0.55',
    ].join('\n'),
  );

  it('exits 3 when a live darwin run breaches its step-10 bounds', async () => {
    const io = mockIOWithExec(async () => ({
      code: 0,
      stdout: DARWIN_LEADERBOARD_SIX_IN_G2,
      stderr: '',
    }));
    const r = await run(['verify-entrypoint', 'darwin', '--cmd', 'npx @metaharness/darwin'], io);
    expect(r.out).toContain('darwin: live');
    expect(r.code).toBe(3);
    expect(r.err).toContain('darwin bounds VIOLATED');
    expect(r.err).toContain('g2 candidates=6 > 5');
    // The promoted-lineage bound is not checked on this path; say so rather than
    // implying all three bounds passed.
    expect(r.err).toContain('promotedLineages unchecked');
  });

  // The real 2026-09-07 run sits inside the step-10 bounds, but every mutant scored
  // 0.765: the scorer judged nothing, so the result is untrustworthy and fails the
  // same way a bound breach does.
  it('exits 3 when every scored mutant has the identical score', async () => {
    const io = mockIOWithExec(async () => ({
      code: 0,
      stdout: DARWIN_LEADERBOARD_2026_09_07,
      stderr: '',
    }));
    const r = await run(['verify-entrypoint', 'darwin', '--cmd', 'npx @metaharness/darwin'], io);
    expect(r.out).toContain('darwin: live');
    expect(r.code).toBe(3);
    expect(r.err).toContain('darwin bounds VIOLATED (leaderboard ok)');
    expect(r.err).toContain('  - score uniformity: all 9 mutants score 0.765, equal to baseline');
    expect(r.out).not.toContain('bounds ok');
  });

  // ADR-0007 amendment: --shim-stats names the Loom shim's per-verdict counts.
  // A uniform leaderboard then fails only when the shim saw no real model edit.
  describe('with --shim-stats (ruvllm mutator)', () => {
    const uniform = () => mockIOWithExec(async () => ({ code: 0, stdout: DARWIN_LEADERBOARD_2026_09_07, stderr: '' }));
    const withStats = (io: IO, json: string) => {
      (io as IO & { files: Record<string, string> }).files['/shim/stats.json'] = json;
      return io;
    };
    const argv = ['verify-entrypoint', 'darwin', '--cmd', 'npx @metaharness/darwin', '--shim-stats', '/shim/stats.json'];

    it('exits 3 when the shim made 0 real mutations', async () => {
      const io = withStats(uniform(), '{"ok":0,"scaffold":20,"truncated":0,"empty":0,"upstream-error":0}');
      const r = await run(argv, io);
      expect(r.code).toBe(3);
      expect(r.err).toContain('0 real mutations: the mutator made no edit');
    });

    it('exits 0 with a non-failing note when real mutations scored the baseline', async () => {
      const io = withStats(uniform(), '{"ok":20,"scaffold":0,"truncated":0,"empty":0,"upstream-error":0}');
      const r = await run(argv, io);
      expect(r.code).toBe(0);
      expect(r.err).not.toContain('VIOLATED');
      expect(r.out).toContain('darwin: no improvement found: 20 real mutations, all scored 0.765 (= baseline)');
      expect(r.out).toContain('darwin bounds ok');
    });

    it('treats a missing shim summary as 0 real mutations', async () => {
      const r = await run(argv, uniform());
      expect(r.code).toBe(3);
      expect(r.err).toContain('darwin: loom shim summary missing at /shim/stats.json — counted as 0 real mutations');
      expect(r.err).toContain('0 real mutations: the mutator made no edit');
    });

    it('treats an unreadable shim summary as 0 real mutations', async () => {
      const r = await run(argv, withStats(uniform(), 'not json'));
      expect(r.code).toBe(3);
      expect(r.err).toContain('loom shim summary unreadable');
    });

    it('exits 0 on a varied leaderboard', async () => {
      const io = withStats(
        mockIOWithExec(async () => ({ code: 0, stdout: DARWIN_LEADERBOARD_VARIED, stderr: '' })),
        '{"ok":3}',
      );
      const r = await run(argv, io);
      expect(r.code).toBe(0);
      expect(r.out).not.toContain('no improvement found');
    });
  });

  it('still exits 0 for a live darwin run that respects the bounds', async () => {
    // Five in g2 is within the ADR-0005 bound, and the scores discriminate.
    const io = mockIOWithExec(async () => ({
      code: 0,
      stdout: DARWIN_LEADERBOARD_VARIED,
      stderr: '',
    }));
    const r = await run(['verify-entrypoint', 'darwin', '--cmd', 'npx @metaharness/darwin'], io);
    expect(r.code).toBe(0);
    expect(r.out).toContain('darwin bounds ok — depth 2, max 5 candidates/generation');
    expect(r.err).not.toContain('VIOLATED');
  });

  // ADR-0005 lever E: scripts/darwin-entrypoint.sh runs darwin THROUGH
  // verify-entrypoint, so the evaluator receipt must still carry darwin's own
  // output (the leaderboard), not only the verdict line.
  it('--passthrough echoes the command output ahead of the verdict', async () => {
    const io = mockIOWithExec(async () => ({
      code: 0,
      stdout: DARWIN_LEADERBOARD_VARIED,
      stderr: 'darwin: ruvllm mutator warming up',
    }));
    const r = await run(
      ['verify-entrypoint', 'darwin', '--passthrough', '--cmd', 'npx @metaharness/darwin'],
      io,
    );
    expect(r.code).toBe(0);
    expect(r.out).toContain('g2_v4  [scorePolicy]');
    expect(r.out.indexOf('Delta over baseline')).toBeLessThan(r.out.indexOf('darwin: live'));
    expect(r.err).toContain('ruvllm mutator warming up');
  });

  it('--passthrough still exits 3 on a breach, with the leaderboard in the receipt', async () => {
    const io = mockIOWithExec(async () => ({
      code: 0,
      stdout: DARWIN_LEADERBOARD_SIX_IN_G2,
      stderr: '',
    }));
    const r = await run(
      ['verify-entrypoint', 'darwin', '--cmd', 'npx @metaharness/darwin', '--passthrough'],
      io,
    );
    expect(r.code).toBe(3);
    expect(r.out).toContain('g2_v5  [planner]');
    expect(r.err).toContain('g2 candidates=6 > 5');
  });

  it('--passthrough echoes a blocked command\'s output too', async () => {
    const io = mockIOWithExec(async () => ({ code: 1, stdout: 'partial', stderr: 'npm error' }));
    const r = await run(
      ['verify-entrypoint', 'darwin', '--passthrough', '--cmd', 'npx @metaharness/darwin'],
      io,
    );
    expect(r.code).toBe(1);
    expect(r.out).toContain('partial');
    expect(r.out).toContain('darwin: blocked');
  });

  it('does not echo the command output without --passthrough', async () => {
    const io = mockIOWithExec(async () => ({
      code: 0,
      stdout: DARWIN_LEADERBOARD_2026_09_07,
      stderr: 'noise',
    }));
    const r = await run(['verify-entrypoint', 'darwin', '--cmd', 'npx @metaharness/darwin'], io);
    expect(r.out).not.toContain('g2_v4');
    expect(r.err).not.toContain('noise');
  });

  it('leaves non-darwin labels unaffected by the bounds check', async () => {
    const io = mockIOWithExec(async () => ({ code: 0, stdout: 'ok', stderr: '' }));
    const r = await run(['verify-entrypoint', 'bench', '--cmd', 'npm test'], io);
    expect(r.code).toBe(0);
    expect(r.err).not.toContain('bounds');
  });

  it('does not run the bounds check when darwin is not live', async () => {
    // A blocked darwin has no leaderboard to read; the unparsable-leaderboard
    // violation must not mask the real verdict (exit 1, blocked).
    const io = mockIOWithExec(async () => ({ code: 1, stdout: '', stderr: 'npm error' }));
    const r = await run(['verify-entrypoint', 'darwin', '--cmd', 'npx @metaharness/darwin'], io);
    expect(r.code).toBe(1);
    expect(r.out).toContain('darwin: blocked');
    expect(r.err).not.toContain('bounds');
  });
});

describe('tui', () => {
  it('renders a dashboard from a ledger', async () => {
    const md = appendRow(emptyLedger(), sampleRow());
    const r = await run(['tui', '--path', 'L.md', '--no-color'], mockIO({ 'L.md': md }));
    expect(r.code).toBe(0);
    expect(r.out).toContain('DREAM MACHINE');
    expect(r.out).toContain('security-adversarial');
    expect(r.out).toContain('never merges');
  });
  it('renderDashboard handles an empty ledger', () => {
    const frame = renderDashboard(emptyLedger(), { noColor: true });
    expect(frame).toContain('no dream nights yet');
  });
  it('shows a zero-merge warning', () => {
    let md = emptyLedger();
    for (let i = 0; i < 14; i++) md = appendRow(md, sampleRow({ pr: `#${i}`, verdict: 'INCONCLUSIVE' }));
    const frame = renderDashboard(md, { noColor: true });
    expect(frame).toContain('zero merges');
  });
  it('counts non-night verdict rows in an "other" bucket so stats sum to nights', () => {
    const md = appendRow(
      appendRow(emptyLedger(), sampleRow({ verdict: 'ACCEPT' })),
      sampleRow({ date: '2026-08-14', verdict: 'BLOCKED-ENV' }),
    );
    const frame = renderDashboard(md, { noColor: true });
    expect(frame).toContain('● 1 other');
    const allNights = renderDashboard(appendRow(emptyLedger(), sampleRow()), { noColor: true });
    expect(allNights).not.toContain('other');
  });
});
