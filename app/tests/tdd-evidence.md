# TDD execution evidence — backend owner

All changes scoped to `backend/`, `tests/`, `package.json`, `package-lock.json`, `README.md`; no frontend files edited. Runs used Node 24.22.1/npm 11.19.1 on Windows. `npm test` runs actual loopback HTTP + temporary SQLite + sharp, not mocked handlers. Fixture names contain SYNTHETIC/Fixture; all photographs are generated colored pixels, not foods or real submissions.

## Observed vertical cycles

The table records real tool runs, not hypothetical output. Features were added after these failures; full suite rerun after each slice.

| Slice | Observed RED before production change | Observed GREEN |
|---|---|---|
| Empty local status/catalogue and guard | First test failed `ERR_MODULE_NOT_FOUND` because backend/app.js did not exist (missing module, not typo). | 1 passed, 0 failed. |
| Durable private intake | Intake test failed `404 !== 201`. | 2 passed; real submission persisted through close/reopen; only sanitized PNG remained; EXIF absent and receipt plaintext absent from SQLite bytes. |
| Strict image/schema admission and bounded intake | Rights/mime validation test failed `201 !== 400`; pause test failed `open !== paused`. | 4 passed, including fake MIME, 20MP boundary violation, >8MiB bytes, >4 images, invalid date, URL, nutrition/attestation rejection, origin denial, quota/queue/body caps. |
| Concurrent durable idempotency | Concurrent responses were `[201,201]`, expected `[200,201]`. | 5 passed; one record/image, restart replay, conflicting payload 409; token returned only on creation. |
| Named moderation/publication and erasure | Admin mutation returned `404 !== 400` in both moderation tests. | 7 passed; reviewed facts projection, fixed not-assessed qualifiers, wrong-vs-right receipt, image deletion and tombstone, admin withdrawal/rejection. |
| Static allowlist and offline recovery | Static route failed `404 !== 200`; backup module missing. | 9 passed after implementation and test-harness corrections below. Real stopped SQLite+images copy restored and authorized image readable/EXIF-free; original receipt deleted restored evidence. Later characterization strengthened this same drill to publish before snapshot and assert restored public facts. |
| Actual CLI | Spawn failed because backend/server.js did not exist. | 10 passed; real child process bound 127.0.0.1 despite HOST=0.0.0.0, paused status, empty catalogue, clean stop. |
| Queue interleaving and stale moderator race | Concurrent queue-cap-one requests both returned 201; delayed admin mutation returned 200 after withdrawal, expected 409. | 12 passed; cap rechecked under serialized intake and moderator row re-read after body await. |
| Withdrawal replay block and private evidence audit | Withdrawn key recreated content (`201 !== 409`); SQLite query failed `no such column: detail`. | 14 passed; key digest blocker retained with payload digest erased, evidence map and attestation privately persisted then removed on withdrawal. |
| Canonical JSON idempotency and server timestamp | Reordered object returned `409 !== 200`; `Date.parse(receivedAt)` assertion failed. | 16 passed; semantic object key ordering stable, genuine PNG/blank optionals accepted and disguised SVG rejected; server receivedAt recorded. |

## Harness/debugging issues (not disguised as application RED)

- Node fetch does not honor an arbitrary `Host` override in this setup. Host-denial test switched to real `node:http.get` with explicit Host, rather than weakening host validation.
- Windows cleanup initially tried to unlink an open restored SQLite DB before closing its server. TAP reporter isolated EBUSY; cleanup now closes the restored app before removing its directory. This had caused one test child to linger after a tool timeout; the exact owned test PID was identified/stopped, not all Node processes.
- `TMPDIR` was absent inside Node although configured in host context. Test fallback now explicitly uses Hermes cache/scratch, not system temp. Fixtures are cleaned by test hooks.
- `npm ci` initially hit EPERM on a DLL held by the lingering owned test process. After stopping that precise test process, a fresh **npm ci --ignore-scripts succeeded** and the complete suite passed. No elevation or force-upgrade workaround.
- Initially selected sharp 0.34.5 had a high-severity native-library advisory. Replaced with exact sharp **0.35.5**, decoded synthetic images with it, and obtained **0 vulnerabilities** from npm audit. Warnings/advisories were not suppressed.

## Final independently rerunnable evidence

Commands actually executed after formatting and the final restore assertion:

```sh
npm ci --ignore-scripts
npm test > tests/latest-test-output.txt 2>&1
npm audit --omit=dev
```

Fresh install: added 5 packages, audited 6, 0 vulnerabilities. Final test log: **16 tests, 16 pass, 0 fail, 0 skipped/cancelled**. Full raw final test output: [latest-test-output.txt](latest-test-output.txt). Final npm audit: **found 0 vulnerabilities**. No experimental warning was emitted by the installed Node 24.22.1; README discloses node:sqlite release-candidate status and older-version ExperimentalWarning behavior.

## Boundaries

Local technical evidence only. No public deployment, public upload, external data writes or real contribution was made. Passing tests do not establish legal clearance, photograph rights beyond pilot-v1, real reviewer identity/MFA, clinical/NAFDAC verification, offsite recovery, decoder sandboxing or internet abuse readiness. README identifies retained blockers and recovery deletion caveats.
