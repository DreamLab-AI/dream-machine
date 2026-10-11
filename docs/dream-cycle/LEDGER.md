| Date | Deep | Finding | Issue | PR | Evaluated? | Verdict | Effect | Witness | Prior-night fates |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-08-13 | security-adversarial | redblue evaluator entrypoint silently no-ops (npx bin-symlink isMain footgun); added classifyEntrypointResult + verify-entrypoint | ruvnet/dream-machine#6 | #7 | yes | ACCEPT | npm test 85->96, 0 regressions | ec2052aa | first real night (demo seed rows removed 2026-08-13; see #6) |
| 2026-08-14 | ledger-signals | Loom timeout (degraded night — model benchmarking) | NONE | NONE | yes | INCONCLUSIVE |  | ec02320f | first HP annexe e2e test |
| 2026-08-14 | developer-experience | ledger signals zeroMergeStreak is an unverified worst-case default (never wired mergedPrNumbers); added --merged flag | ruvnet/dream-machine#8 | #9 | yes | ACCEPT | npm test 96->101, 0 regressions | e55f6413 | PR #7 merged by human 2026-08-13 (ironic: the exact merge the buggy signal missed) |
| 2026-08-15 | golden-snapshots | Darwin fitness saturated: 9 mutants x 5 genotype surfaces all = baseline 0.985; evaluator sensitivity unproven | NONE | NONE | yes | INCONCLUSIVE | +0.000 | 46445823 | GLM-5.3 via Z.AI |
| 2026-08-15 | evaluation-adapters | Loom timeout (degraded night) | NONE | NONE | yes | INCONCLUSIVE |  | de2ce03a |  |
| 2026-08-15 | evaluation-adapters | INCONCLUSIVE — see report | NONE | NONE | yes | INCONCLUSIVE |  | 7b050758 |  |
| 2026-08-15 | evaluation-adapters | Given the committed bench corpus (96 tests) and the Darwin fitness harness, when | NONE | NONE | yes | REJECT |  | e6af8d3b |  |
| 2026-08-15 | compiler-parity | Given the `compile` package's 19 unit tests expose no golden-snapshot fixtures v | NONE | NONE | yes | REJECT |  | 4d4245aa1959 |  |
| 2026-08-15 | compiler-parity | INCONCLUSIVE — see report | NONE | NONE | yes | INCONCLUSIVE |  | 9c55670e3550 |  |
| 2026-08-15 | compiler-parity | Given the Darwin evaluator configured with `--sandbox mock --mutator ruvllm --ru | NONE | NONE | yes | ACCEPT |  | 4d86e582cc13 |  |
| 2026-08-15 | compiler-parity | self-hosted dream.config.json had zero test coverage in @dream-machine/compile; added golden-snapshot + validation test reading the real config | ruvnet/dream-machine#10 | ruvnet/dream-machine#11 | yes | ACCEPT | npm test 96->100, 0 regressions | cf2f0711 | PR #7 merged 2026-08-13; PR #9 (2026-08-14) still open/draft, human review pending |
| 2026-08-16 | ledger-signals | Given the persisted ledger rows for 2026-08-15 carry empty `prior-night fates` ( | NONE | NONE | yes | ACCEPT |  | da74cb43142a |  |
| 2026-08-16 | ledger-signals | Given the Darwin evaluator at commit `8c945e3` runs with `--sandbox mock --mutat | NONE | NONE | yes | ACCEPT |  | 4e40f4930fa3 |  |
| 2026-08-16 | ledger-signals | zeroMergeStreak permanently miscalibrated (CLI never wires mergedPrNumbers); now derived from Prior-night fates #N:FATE tokens (parsePriorFates), unioned with our --merged override | ruvnet/dream-machine#14 | ruvnet/dream-machine#15 | yes | ACCEPT | npm test 96->100, 0 regressions | 4fac9b71 | consolidated from ruvnet/dream-machine PR #15; upstream fate tokens omitted here (their PR numbers differ from this fork's) |
| 2026-08-17 | evaluation-adapters | Given the Darwin evaluator at commit `569285b` configured with `--sandbox mock - | NONE | NONE | yes | ACCEPT |  | 7ecbf140d180 |  |
| 2026-08-17 | evaluation-adapters | Given the Darwin evaluator at commit `569285b` configured with `--sandbox mock - | NONE | NONE | yes | ACCEPT |  | 9bf1005b390a |  |
| 2026-08-28 | ledger-signals | fate reconciliation (agentbox operator audit): judgment-broker queue showed #9/#11/#15 as pending-merge; their changes landed 2026-08-13..15 (#7/#9 consolidated into the fork by human merge, #11/#15 merged in upstream ruvnet/dream-machine whose PR numbering this ledger borrowed) — recording terminal fates so the queue clears | NONE | NONE | no | INCONCLUSIVE |  | operator | #7:MERGED #9:MERGED #11:MERGED #15:MERGED |
| 2026-09-01 | ledger-signals | INCONCLUSIVE — see report | NONE | NONE | yes | INCONCLUSIVE |  | bdb6735f5b3b |  |
| 2026-09-02 | evaluation-adapters | Given the Darwin evaluator at commit `7c30573a2d73c8fa4c67a43042d7c0b204eefa13`  | NONE | NONE | yes | ACCEPT |  | ca5d950d60bc |  |
| 2026-09-03 | security-adversarial | Given the dream-machine tree at commit `7c30573a2d73c8fa4c67a43042d7c0b204eefa13 | NONE | NONE | yes | ACCEPT |  | 1a4711f76d90 |  |
| 2026-09-04 | developer-experience | Given commit `7c30573a2d73c8fa4c67a43042d7c0b204eefa13` with `tui` declared amon | NONE | NONE | yes | ACCEPT |  | 270d82f5fb87 |  |
| 2026-09-05 | compiler-parity | Given the dream-engine tree at commit `7c30573a2d73c8fa4c67a43042d7c0b204eefa13` | NONE | NONE | yes | ACCEPT |  | 492a9831cd9b |  |
| 2026-09-06 | ledger-signals | ledger row-contract validator added; last 5 rows (09-01..05) all violate format | NONE | https://github.com/DreamLab-AI/dream-engine/pull/10 | yes | ACCEPT |  | d288b79b6292 |  |
| 2026-09-07 | evaluation-adapters | darwin gen2 ran 5 candidates (≤4/gen bound broken); evaluator still PASSED | NONE | https://github.com/DreamLab-AI/dream-engine/pull/11 | yes | ACCEPT |  | cae9a2589672 |  |
| 2026-09-07 | operator-handoff | OPERATOR: PR #11 landed as ADR-0003; darwin bound guard in verify-entrypoint | NONE | https://github.com/DreamLab-AI/dream-engine/pull/11 | n/a | OPERATOR |  | operator | #11:MERGED |
| 2026-09-08 | security-adversarial | VETOED: ADR-0003 guard in-tree yet gate fail-open: g2=5 breach 2nd night, darwin | NONE | NONE | yes | INCONCLUSIVE |  | 3a8907c2fda9 |  |
| 2026-09-09 | developer-experience | VETOED: Given the pinned darwin@0.10.2 run on dream-engine@a82dab2 whose receipt | NONE | NONE | yes | BLOCKED-ENV |  | 4acf367ac276 |  |
| 2026-09-10 | compiler-parity | VETOED: compile goldens covered 4/5 schema surfaces; scorePolicy golden added (5 | NONE | VETOED | yes | REJECT |  | 6e3777004730 |  |
| 2026-09-11 | ledger-signals | No VERDICT line; bench and darwin receipts missing; gate vetoed | NONE | NONE | yes | INCONCLUSIVE |  | 1bf0dad716ef |  |
| 2026-09-12 | evaluation-adapters | VETOED: g2=5 is structural: pinned darwin enumerates all 5 config surfaces at ge | NONE | NONE | yes | INCONCLUSIVE |  | b03d8d30e9ce |  |
| 2026-09-13 | security-adversarial | VETOED: Gate veto keys on darwin exit code only; g2=5 breach 4th obs, 0 ACCEPTs  | NONE | NONE | yes | INCONCLUSIVE |  | d92b39d969db |  |
| 2026-09-27 | evaluation-adapters | VETOED: Given the pinned darwin@0.10.2 structurally enumerates 5 config surfaces | NONE | NONE | yes | BLOCKED-ENV |  | 44ff7782903a |  |  |  |
| 2026-09-28 | security-adversarial | Darwin pin discipline is now a test: one exact pin or bench fails (fa6e42a) | NONE | https://github.com/DreamLab-AI/dream-engine/pull/18 | yes | ACCEPT |  | 99846f8ae29f |  |  |  |
| 2026-09-29 | developer-experience | VETOED: Given `DashboardOptions.limit` is honored by `renderDashboard` but never | NONE | NONE | yes | BLOCKED-ENV |  | 6292c91fb471 |  |  |  |
| 2026-09-30 | compiler-parity | validateConfig now rejects a malformed adrConvention (5816164) | NONE | https://github.com/DreamLab-AI/dream-engine/pull/19 | yes | ACCEPT |  | 847508569d87 |  |  |  |
| 2026-10-01 | ledger-signals | VETOED: Given `escapeCell` renders a literal pipe in a cell as `\` (`packages/le | NONE | NONE | yes | INCONCLUSIVE |  | 829ff1ef88ce |  |  |  |
| 2026-10-02 | evaluation-adapters | VETOED: Updated maxCandidatesPerGeneration bound to 5 to match darwin@0.10.2 out | NONE | NONE | yes | BLOCKED-ENV |  | ee55ffc8351d |  |  |  |
| 2026-10-03 | security-adversarial | New checkDarwinScoreUniformity flags leaderboards where all mutants tie baseline | NONE | https://github.com/DreamLab-AI/dream-engine/pull/21 | yes | ACCEPT |  | f6b941585a3c |  |  |  |
| 2026-10-04 | developer-experience | Bench red on the 10-03 row only; rewrote its finding, bench and darwin pass | NONE | https://github.com/DreamLab-AI/dream-engine/pull/22 | yes | ACCEPT |  | c35da17fd617 |  |  |  |
| 2026-10-04 | developer-experience | validateConfig now rejects a malformed adrConvention (5816164) | NONE | PERSIST-LOCAL | yes | ACCEPT |  | bd972b37f37a |  |  |  |
| 2026-10-05 | compiler-parity | Bench red on the 10-03 row; repair patch did not apply to LEDGER.md | NONE | NONE | yes | BLOCKED-ENV |  | e3bbab427018 |  |  |  |
| 2026-10-06 | ledger-signals | Bench red on the 10-03 row again; same repair as PR #22, bench and darwin pass | NONE | https://github.com/DreamLab-AI/dream-engine/pull/23 | yes | ACCEPT |  | 3e348c630519 |  |  |  |
| 2026-10-07 | evaluation-adapters | New bench test pins darwin evaluator to scripts/darwin-entrypoint.sh wrapper | NONE | https://github.com/DreamLab-AI/dream-engine/pull/27 | yes | ACCEPT |  | fd7a41d5a3c1 |  |  |  |
| 2026-10-08 | security-adversarial | pre-pin npx flags bypassed the darwin pin; wrapper now refuses them | NONE | https://github.com/DreamLab-AI/dream-engine/pull/28 | yes | ACCEPT |  | 0fa10caa4075 |  |  |  |
| 2026-10-09 | developer-experience | VETOED: TUI stats undercounted non-night verdict rows; now sums via gray other… | NONE | NONE | yes | BLOCKED-ENV |  | c9092e8520a7 |  |  |  |
| 2026-10-10 | compiler-parity | VETOED: validateConfig errors on malformed slots/scans/bonusModuli names (was… | NONE | NONE | yes | BLOCKED-ENV |  | 2ff1e4effe60 |  |  |  |
