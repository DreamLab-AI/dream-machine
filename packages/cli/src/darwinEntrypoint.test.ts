import { afterEach, describe, expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// ADR-0005 lever E: scripts/darwin-entrypoint.sh is the darwin evaluator
// entrypoint. It runs the pinned darwin command THROUGH verify-entrypoint, so
// a bound breach exits non-zero and the annexe records the REQUIRED evaluator
// as FAILED instead of PASSED. These tests drive the real script against a
// stub darwin (test-fixtures/fake-darwin.mjs) printing captured leaderboards;
// they need `npm run build` first, as CI and the annexe build step both do.

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SCRIPT = join(ROOT, 'scripts/darwin-entrypoint.sh');
const FIXTURES = 'packages/cli/test-fixtures';
const FAKE = `${FIXTURES}/fake-darwin.mjs`;
const PIN = '@metaharness/darwin@0.10.2';
const LB_FIVE = `${FIXTURES}/darwin-leaderboard-varied.txt`;
const LB_UNIFORM = `${FIXTURES}/darwin-leaderboard-2026-09-07.txt`;
const LB_SIX = `${FIXTURES}/darwin-leaderboard-six-in-g2.txt`;

// ADR-0008: the script admits only `npx <pin> …` heads, so the stub must be
// reached the way the real evaluator is — through npx. fakeNpxDir() writes a
// one-line `npx` under node_modules/.cache (writable and executable wherever
// the repo itself is) that execs the fixture with the arguments it was given.
let npxStubDir: string | undefined;
function fakeNpxDir(): string {
  if (!npxStubDir) {
    npxStubDir = join(ROOT, 'node_modules', '.cache', `dream-darwin-npx-${process.pid}`);
    mkdirSync(npxStubDir, { recursive: true });
    const npx = join(npxStubDir, 'npx');
    writeFileSync(npx, `#!/bin/sh\nexec node ${JSON.stringify(join(ROOT, FAKE))} "$@"\n`);
    chmodSync(npx, 0o755);
  }
  return npxStubDir;
}

afterEach(() => {
  if (npxStubDir) {
    rmSync(npxStubDir, { recursive: true, force: true });
    npxStubDir = undefined;
  }
});

function runScript(args: string[], env: Record<string, string> = {}) {
  if (!existsSync(join(ROOT, 'packages/cli/dist/bin.js'))) {
    throw new Error('packages/cli/dist/bin.js missing — run `npm run build` before this suite');
  }
  const r = spawnSync(SCRIPT, args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: process.env.PATH ? `${fakeNpxDir()}:${process.env.PATH}` : fakeNpxDir(),
      ...env,
    },
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** A darwin-shaped command line the script admits, routed to the stub through
 *  the PATH-shimmed npx — the same head shape as the real evaluator. */
const stub = (...extra: string[]) => [
  'npx', PIN, 'evolve', '.', '--sandbox', 'mock', ...extra,
];

describe('scripts/darwin-entrypoint.sh', () => {
  it('is checked in executable, as the annexe invokes it directly', () => {
    expect(statSync(SCRIPT).mode & 0o111).not.toBe(0);
  });

  it('exits 0 and keeps the leaderboard in the receipt when g2 holds 5 candidates', () => {
    const r = runScript(stub('--leaderboard', LB_FIVE));
    expect(r.stderr).not.toContain('VIOLATED');
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('g2_v4  [scorePolicy]');
    expect(r.stdout).toContain('darwin: live');
    expect(r.stdout).toContain('darwin bounds ok — depth 2, max 5 candidates/generation');
  });

  it('exits 3 when every mutant scores the same (real 2026-09-07 leaderboard)', () => {
    const r = runScript(stub('--leaderboard', LB_UNIFORM));
    expect(r.code).toBe(3);
    expect(r.stdout).toContain('Delta over baseline: +0.000');
    expect(r.stderr).toContain('darwin bounds VIOLATED');
    expect(r.stderr).toContain('score uniformity: all 9 mutants score 0.765');
  });

  it('exits 3 on a bound breach (6 candidates in g2)', () => {
    const r = runScript(stub('--leaderboard', LB_SIX));
    expect(r.code).toBe(3);
    expect(r.stdout).toContain('g2_v5  [planner]');
    expect(r.stderr).toContain('darwin bounds VIOLATED');
    expect(r.stderr).toContain('g2 candidates=6 > 5');
  });

  it('exits non-zero when darwin itself fails', () => {
    const r = runScript(stub('--exit', '7'));
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('darwin: blocked');
  });

  it('exits non-zero when darwin succeeds silently', () => {
    const r = runScript(stub());
    expect(r.code).toBe(2);
    expect(r.stdout).toContain('darwin: suspicious-silent');
  });

  it('passes arguments through verbatim and the environment to darwin', () => {
    const r = runScript(
      stub('--leaderboard', LB_FIVE, '--note', "two words, a 'quote' and $HOME", '--report-args'),
      { RUVLLM_TIMEOUT_MS: '180000' },
    );
    expect(r.code).toBe(0);
    expect(r.stderr).toContain('"--note","two words, a \'quote\' and $HOME"');
    expect(r.stderr).toContain('fake-darwin RUVLLM_TIMEOUT_MS=180000');
  });

  it.each([
    ['no command', []],
    ['an unpinned darwin', ['npx', '@metaharness/darwin', 'evolve', '.', '--sandbox', 'mock']],
    ['a ranged darwin', ['npx', '@metaharness/darwin@^0.10.2', 'evolve', '.', '--sandbox', 'mock']],
    ['two different pins', [...stub(), '@metaharness/darwin@0.11.0']],
    ['a command that is not darwin', ['node', FAKE, '--leaderboard', LB_FIVE, '--sandbox', 'mock']],
    ['the default real sandbox', ['node', FAKE, PIN, 'evolve', '.', '--leaderboard', LB_FIVE]],
    ['an explicit real sandbox', ['node', FAKE, PIN, 'evolve', '.', '--sandbox', 'real']],
    // darwin reads only `--flag value`; `--sandbox=mock` would run the real sandbox.
    ['a --sandbox=mock spelling darwin ignores', ['node', FAKE, PIN, 'evolve', '.', '--sandbox=mock']],
    ['a --ruvllm-url=URL spelling darwin ignores', [...stub('--mutator', 'ruvllm'), '--ruvllm-url=http://x']],
    // ADR-0008: tokens do not bind a command — the head must resolve the pin,
    // and a repeated tracked flag makes the checked value ambiguous.
    ['an arbitrary head carrying the required tokens', ['bash', '-c', 'evil', PIN, 'evolve', '.', '--sandbox', 'mock']],
    ['a node head instead of npx resolving the pin (the former stub shape)', ['node', FAKE, PIN, 'evolve', '.', '--sandbox', 'mock']],
    ['pre-pin npx flags', ['npx', '--yes', PIN, 'evolve', '.', '--sandbox', 'mock']],
    ['a repeated --sandbox flag', [...stub(), '--sandbox', 'real']],
  ])('refuses %s with exit 64 before running anything', (_name, args) => {
    const r = runScript([...args, '--report-args']);
    expect(r.code).toBe(64);
    expect(r.stderr).toContain('darwin-entrypoint:');
    expect(r.stderr).not.toContain('fake-darwin argv=');
  });
});

// ADR-0007: with --mutator ruvllm, the script routes darwin's mutator through
// the loopback Loom shim. These cases run the script asynchronously so an
// in-process fake Loom can answer while the script is running.
describe('scripts/darwin-entrypoint.sh with the ruvllm mutator', () => {
  let loom: Server | undefined;

  afterEach(async () => {
    await new Promise<void>((resolve) => (loom ? loom.close(() => resolve()) : resolve()));
    loom = undefined;
  });

  /** Fake Loom: records request bodies; answers like the real one after `delayMs`. */
  async function fakeLoom(delayMs: number, opts: { alwaysScaffold?: boolean } = {}) {
    const seen: Record<string, unknown>[] = [];
    loom = createServer(async (req, res) => {
      let body = '';
      for await (const chunk of req) body += chunk;
      const parsed = JSON.parse(body) as { loom_options?: { scaffold?: boolean } };
      seen.push(parsed);
      const content =
        parsed.loom_options?.scaffold === false && !opts.alwaysScaffold
          ? 'export const maxAttempts = 5;\n'
          : '_Served verbatim from the Ontology Loom (generation: x); no model generation was performed._';
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ index: 0, finish_reason: 'stop', message: { content } }] }));
      }, delayMs);
    });
    await new Promise<void>((resolve) => loom!.listen(0, '127.0.0.1', resolve));
    return { url: `http://127.0.0.1:${(loom.address() as AddressInfo).port}`, seen };
  }

  function runScriptAsync(args: string[], env: Record<string, string> = {}) {
    return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
      const child = spawn(SCRIPT, args, {
        cwd: ROOT,
        env: {
          ...process.env,
          PATH: process.env.PATH ? `${fakeNpxDir()}:${process.env.PATH}` : fakeNpxDir(),
          ...env,
        },
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => (stdout += d));
      child.stderr.on('data', (d) => (stderr += d));
      child.on('close', (code) => resolve({ code, stdout, stderr }));
    });
  }

  it('reaches the model: scaffold off, and a slow answer outlives darwin\'s header timeout', async () => {
    const fake = await fakeLoom(800); // longer than the stub's 300 ms abort
    const r = await runScriptAsync(
      stub('--mutator', 'ruvllm', '--ruvllm-url', fake.url, '--ruvllm-model', 'qwen3.8-27B',
        '--call-mutator', '--leaderboard', LB_FIVE),
      { RUVLLM_TIMEOUT_MS: '5000' },
    );
    expect(r.stderr).toContain('fake-darwin mutator content="export const maxAttempts = 5;\\n"');
    expect(fake.seen).toHaveLength(1);
    expect(fake.seen[0]).toMatchObject({ model: 'qwen3.8-27B', loom_options: { scaffold: false } });
    expect(r.stderr).toMatch(/loom-shim: .*ok=1/);
    expect(r.code).toBe(0);
  });

  // ADR-0007 amendment: a uniform leaderboard fails only an inert run, judged
  // by the shim's count of real model edits.
  it('(a) exits 3 on a uniform leaderboard when the shim saw 0 real mutations', async () => {
    const fake = await fakeLoom(0, { alwaysScaffold: true });
    const r = await runScriptAsync(
      stub('--mutator', 'ruvllm', '--ruvllm-url', fake.url, '--call-mutator', '--leaderboard', LB_UNIFORM),
    );
    expect(fake.seen).toHaveLength(1);
    expect(r.stderr).toMatch(/loom-shim: summary ok=0 scaffold=1/);
    expect(r.stderr).toContain('0 real mutations: the mutator made no edit');
    expect(r.code).toBe(3);
  });

  it('(b) exits 0 with a note on a uniform leaderboard after real mutations', async () => {
    const fake = await fakeLoom(0);
    const r = await runScriptAsync(
      stub('--mutator', 'ruvllm', '--ruvllm-url', fake.url, '--call-mutator', '--leaderboard', LB_UNIFORM),
    );
    expect(r.stderr).not.toContain('VIOLATED');
    expect(r.stdout).toContain('darwin: no improvement found: 1 real mutation, all scored 0.765 (= baseline)');
    expect(r.code).toBe(0);
  });

  it('(c) exits 3 on a uniform leaderboard when the shim left no summary', async () => {
    const fake = await fakeLoom(0);
    const r = await runScriptAsync(
      stub('--mutator', 'ruvllm', '--ruvllm-url', fake.url, '--leaderboard', LB_UNIFORM),
    );
    expect(fake.seen).toHaveLength(0);
    expect(r.stderr).toContain('loom shim summary missing');
    expect(r.code).toBe(3);
  });

  it('(d) exits 0 on a varied leaderboard', async () => {
    const fake = await fakeLoom(0);
    const r = await runScriptAsync(
      stub('--mutator', 'ruvllm', '--ruvllm-url', fake.url, '--call-mutator', '--leaderboard', LB_FIVE),
    );
    expect(r.stdout).toContain('darwin bounds ok');
    expect(r.stdout).not.toContain('no improvement found');
    expect(r.code).toBe(0);
  });

  it('leaves a non-ruvllm darwin run untouched', async () => {
    const r = await runScriptAsync(stub('--leaderboard', LB_FIVE, '--report-args'));
    expect(r.code).toBe(0);
    expect(r.stderr).not.toContain('loom-shim');
  });

  it('refuses a ruvllm mutator with no --ruvllm-url, as the Loom door must be explicit', async () => {
    const r = await runScriptAsync(stub('--mutator', 'ruvllm', '--leaderboard', LB_FIVE, '--report-args'));
    expect(r.code).toBe(64);
    expect(r.stderr).toContain('--ruvllm-url');
    expect(r.stderr).not.toContain('fake-darwin argv=');
  });
});

describe('dream.config.json darwin evaluator', () => {
  const config = JSON.parse(readFileSync(join(ROOT, 'dream.config.json'), 'utf8')) as {
    evaluatorEntrypoints: Record<string, string>;
    extraDisciplines: string[];
  };
  const cmd = config.evaluatorEntrypoints.darwin;

  it('runs darwin through the checked-in entrypoint script', () => {
    expect(cmd).toMatch(/(^|\s)\.\/scripts\/darwin-entrypoint\.sh\s/);
  });

  // The dream-engine annexe's admission (agentbox services/dream-engine
  // readiness.rs) recognises darwin by the package name in the command and
  // refuses it without --sandbox mock|agent. Keeping the full darwin command
  // visible in config, rather than hidden inside the script, keeps that check
  // live.
  it('keeps the pinned darwin command and its sandbox visible to admission', () => {
    expect(cmd).toContain(` ${PIN} evolve . `);
    expect(cmd).toContain('--sandbox mock');
  });

  it('pins the same darwin version the pinned-evaluator discipline records', () => {
    expect(config.extraDisciplines.join('\n')).toContain(PIN);
  });
});
