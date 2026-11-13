# NutriAfrica — local-only contribution backend

**Local preview, not a live collection service or public-deployment-ready product.** No seed records, external imports, OCR, remote URL fetching, health profiles or nutrient calculations. Tests use generated, explicitly synthetic image fixtures, never collected foods. `public/` and `ui-tests/` are separate-owner frontend artifacts.

## Frontend integration (verified locally)

The contribution interface is at `/`; private moderation is at `/admin.html`. Configure a private ADMIN_TOKEN before using moderation; without one it fails closed. The default running preview has no configured admin token. Tokens are never saved to browser localStorage. Publication form deliberately exposes only product name and observed market; the API supports additional allowlisted facts described below.

Parent integration checks:

```sh
node --test ui-tests/model.test.mjs
node ui-tests/browser.mjs
node ui-tests/fullstack.mjs
```

The two browser scripts use the installed taste-skill CDP helper at its explicit local path and installed Chrome/Edge. They are local verification helpers, not a portable CI setup. Full-stack check creates isolated synthetic evidence, uses the real contribution UI, private moderator UI, SQLite and image decoding, publishes a fixture factual projection, withdraws via the public receipt form, and checks active image deletion plus hidden tombstone. Its temporary data directory is removed; fixtures are not seed foods.

Regression coverage includes missing receipt on idempotent replay, correct paused-status display and suppressed withdrawn tombstones. A lost first-response receipt cannot be recovered in this preview; the UI says so instead of displaying an undefined token. Never upload a real label or personal information to this local test.

## Run locally

Requires Node **24.x** and npm. Tested on Windows with Node 24.22.1. From this `app/` directory:

```sh
npm ci --ignore-scripts
npm test
npm start
```

Open **http://127.0.0.1:4318** (not `localhost`). Binding is hard-coded to `127.0.0.1`; `HOST` is ignored. Host-header validation also rejects DNS-rebinding hosts. No TLS tunnel, hosting or public deployment is authorized or described here. Stop with Ctrl+C.

Environment:

| Variable | Default / meaning |
|---|---|
| `PORT` | `4318`; `0` requests an OS-assigned local port for testing |
| `DATA_DIR` | `%LOCALAPPDATA%/NutriAfrica/local-preview` on Windows, otherwise `~/.local/share/NutriAfrica/local-preview`; must not be inside public |
| `ADMIN_TOKEN` | No default: administrative API fails closed unless token is at least 32 characters. Use a securely generated random secret, not the synthetic test token. Never place it in frontend code, URLs, source control or logs. |
| `INTAKE_PAUSED` | Set exactly `1` to reject new submissions with 503; restart to change. Status remains readable, withdrawal and review remain available. |

Data is **outside public and outside this cloud-synced repository by default**. Do not select an ephemeral disk, shared/synced folder or publicly served directory. Set OS ACLs to the operator only; POSIX mode flags are not a Windows ACL guarantee. Use one process per data directory. No application logging of request bodies, IPs, images, receipt tokens or admin secrets is implemented.

`sharp` 0.35.5 is the only direct runtime dependency; prebuilt Windows binary was actually exercised. An initially evaluated 0.34.5 had a high-severity npm advisory and was replaced, not waived. Final audit returned zero known vulnerabilities, not a guarantee of safety. Node `node:sqlite` avoids another native database dependency. Current Node 24 docs classify it **release candidate (stability 1.2)** from 24.15; older Node 24 builds may emit an **ExperimentalWarning**. This implementation does not suppress warnings.

Primary technical references used: [sharp installation](https://sharp.pixelplumbing.com/install/), [constructor security limits](https://sharp.pixelplumbing.com/api-constructor/), [metadata-stripping output default](https://sharp.pixelplumbing.com/api-output/), [Node 24 SQLite](https://nodejs.org/docs/latest-v24.x/api/sqlite.html).

## Exact HTTP contract

All JSON mutations require `Content-Type: application/json`. Unknown top-level fields are rejected. No CORS grants are returned. Browser writes must use the exact local origin; foreign or `null` origins and cross-site fetch writes are rejected. Nonbrowser local clients may omit Origin. API responses use `Cache-Control: no-store`, CSP, nosniff, no-referrer and same-origin resource policy. API error bodies are deliberately generic `{ "error": "Request rejected" }` (or generic not-found/internal-error messages).

### `GET /api/status`

200:

```json
{"mode":"local-preview","intake":"open","termsVersion":"pilot-v1","nutrition":"not_supported","images":"private_only"}
```

`intake` is `paused` when the operator pause switch is active. `open` means not operator-paused, not a promise that a request will evade rate/concurrency/backlog limits.

### `POST /api/submissions`

```json
{
  "productName":"Name as observed",
  "brand":"Brand as observed or blank",
  "market":"Nigeria",
  "city":"",
  "barcode":"",
  "nafdac":"",
  "capturedOn":"2026-11-01",
  "rightsAccepted":true,
  "adultConfirmed":true,
  "termsVersion":"pilot-v1",
  "images":[{"role":"front","dataUrl":"data:image/jpeg;base64,..."}]
}
```

- Required: nonblank productName (max 180), brand (max 120, may be blank), exact market, ISO calendar capture date (not future), both true attestations, exact terms version, 1–4 images. Optional city max 80, barcode max 40, nafdac max 80; blank or omitted accepted. Preserve printed identifier strings; no invented NAFDAC-format or authenticity validator.
- Image roles: `front`, `nutrition`, `ingredients`, `barcode`. Canonical base64 PNG/JPEG data URLs only; MIME must agree with decoded format. No SVG, remote URLs, animations/multiple frames or file path inputs.
- Each input **and sanitized output** <=8 MiB, dimensions <=20,000,000 pixels. Decoder warnings/truncation fail closed. Full decode, EXIF orientation application and PNG re-encoding strip EXIF/ICC/XMP/other metadata. Only sanitized PNGs are persisted. Raw bytes/data URLs are discarded, never served or written as originals. Images **remain private in every state**, including published.
- Nutrition objects, arbitrary contact/health fields and unrecognized keys are rejected. A nutrition-role photo does not produce structured nutrition facts or zeros.
- Default JSON body limit 35 MiB; four maximum-sized images may exceed it because of base64 overhead. At most two active intake requests; processing serialized to avoid duplicate writes. Per-socket-IP quota 30 attempts/hour, bounded in-memory map (1024 entries), no forwarded-IP trust; restart resets quota. Pending queue cap 500 includes received and human-review records; rechecked under the mutation lock. 32 connections, 30-second request timeout, 10-second header timeout, 35-second socket inactivity timeout, 5-second decoder processing timeout.

201, **receipt secret returned once only**:

```json
{"id":"server-uuid","receiptToken":"random-256-bit-base64url-secret","state":"received_private"}
```

Receipt token is random and only its SHA-256 hash is stored. No receipt listing/read route exists. Keep the first response securely; losing the receipt means no self-service recovery in this preview.

Optional `Idempotency-Key`: 8–128 ASCII letters/digits/underscore/hyphen. Same key + same semantic JSON (object key order ignored; array order and exact values matter) returns **200 `{id,state,replayed:true}` with NO receiptToken**. Concurrent retries produce one stored submission and one image set. Different payload returns 409. Key and payload digests are stored, never raw key or response secret. After withdrawal, the key is permanently blocked with 409 and its payload digest erased. A network-lost first receipt is an explicit limitation, not a reason to store plaintext tokens. The frontend must not overwrite an existing saved receipt on a replay response.

Other errors: 400 schema/image/key, 413 body too large, 415 media type, 429 quota, 503 pause/concurrency/queue cap.

### `GET /api/catalogue`

200 `{ "items": [] }` on fresh storage. No fixtures are seeded. Published items contain only an explicit facts projection plus system qualifiers; private submission fields, city, filenames, receipts and reviewer identity are never copied wholesale. Withdrawn records are `{ "id":"...", "state":"withdrawn" }` tombstones, not preserved factual/private content. Clients must discard cached facts when seeing a tombstone.

### `POST /api/withdraw`

Body `{ "id":"server-uuid", "receiptToken":"first-response-secret" }`. Correct receipt returns 200 `{id,state:"withdrawn"}`; wrong/missing-record/already-consumed receipt returns 404 (malformed schema 400). Constant-time digest comparison; token never in URL.

Deletes sanitized image files, private submission JSON, receipt hash, private publication evidence detail and payload digest; replaces public projection with a nonidentifying tombstone. Marks `withdrawing` before file deletion; interrupted deletion resumes on next startup. A hashed idempotency key/ID blocker and moderator action/reviewer/time records remain; moderator names are administrative records, not contributor identity. No filesystem secure-erasure or backup deletion guarantee is claimed.

### Administrator API

Every route below requires `Authorization: Bearer <ADMIN_TOKEN>`, with fixed-length digest timing-safe comparison; missing, short or incorrect configured token fails closed with 401. Never embed the token in static admin UI code. This is a single local operator credential, **not MFA or a real multi-user identity system**. A reviewer name is an attestation, not independently authenticated identity.

- `GET /api/admin/submissions`: 200 `{items:[{id,state,submission,images}]}`; up to 1000 rows, no claimed total. `submission` includes server `receivedAt`. Images are private descriptors `{name,role,digest}`. No receipt hashes/tokens or raw payloads. Withdrawn submission is null and images empty.
- `GET /api/admin/submissions/:id/images/:index`: exact UUID + zero-based integer index route, authorized only; returns sanitized `image/png`, never the original. Missing/out-of-range routes 404. Names and arbitrary paths are not accepted as image selectors.
- `POST /api/admin/submissions/:id`: action `review`, `reject`, `publish` or `withdraw`, with nonblank named `reviewer` <=120 characters. `review` -> `human_review`; `reject` -> `rejected` and suppresses public projection; `withdraw` -> erasure/tombstone. Withdrawn records cannot be revived (409), including a slow in-flight moderator request.

Publication example, **only after `review`**:

```json
{
  "action":"publish",
  "reviewer":"Named local human reviewer",
  "attestedFromImages":true,
  "publicFields":{"productName":"Exact transcribed label name","brand":"Exact brand","market":"Nigeria"},
  "evidence":{"productName":0,"brand":0,"market":0}
}
```

Publication requires accepted pilot rights/adult policy, named reviewer, prior review, private evidence images, explicit image-transcription attestation and an in-range image index for **every supplied public field**. Allowlist: productName (required), market (`Nigeria`, required), brand, barcode, nafdac, capturedOn. All facts must be transcribed from legible photographs; market is the observation context, and capturedOn, if included, must equal the submitted capture date (not a pack formulation/expiry date). Evidence map and attestation are stored privately with the reviewer event. No nutrition, allergy, safety or regulatory verdict fields may be supplied. Reviewer must reject/redact personal details in factual text; automated schema checking does not prove the text is true or free of identifiers.

Public qualifiers are server-set: `method:"label"`, `transcription:"human_reviewed"`, `registryLookup:"not_attempted"`, `physicalAuthenticity:"not_assessed"`, `allergens:"unknown"`, `nutrition:"not_documented"`, `rights:"approved_facts_only"`. This is **not lab verification, a NAFDAC lookup/approval, pack authentication or dietary advice**.

`pilot-v1` grants local testing permission to store, inspect, transcribe, sanitize and publish approved factual fields only. It **does not grant commercial photograph resale or public image redistribution**. No handler promotes any uploaded image to public storage. A checkbox does not resolve all third-party package-artwork or privacy rights.

## Static boundary

GET exact allowlist only: `/`, `/index.html`, `/style.css`, `/ui-model.mjs`, `/main.mjs`, `/plex-regular.ttf`, `/plex-medium.ttf`, `/plex-semibold.ttf`, `/admin.html`, `/admin.mjs`. Missing optional files return 404. No directory browsing, fallback to arbitrary files, user-controlled image/static paths or encoded traversal. A static admin shell is not authorization; every API/image access is separately protected.

## Backup and restore exercise

SQLite plus sanitized `images/` are one recovery unit. **Stop the sole process first.** `backend/backup.js` exports `backupStopped(source,destination)` and `restoreStopped(source,destination)`, copies only the database/image directory into a new nonexisting destination, and runs SQLite `integrity_check`. It does not detect a running source process or provide online snapshots/encryption. Do not copy a live database or partially sync these files.

Example Node module invocation after stopping (replace both private absolute paths; do not use public/repository folders):

```sh
node --input-type=module -e 'import {backupStopped} from "./backend/backup.js"; await backupStopped("C:/private/nutri-data","C:/private/nutri-snapshot");'
node --input-type=module -e 'import {restoreStopped} from "./backend/backup.js"; await restoreStopped("C:/private/nutri-snapshot","C:/private/nutri-restored");'
```

Set `DATA_DIR` to the restored directory and restart. Protect and encrypt backups using operator-managed facilities; no backup automation/retention policy is implemented. Keep deletion records separate from old snapshots and **reapply all later withdrawals before making a restored snapshot available**. Otherwise restoration can resurrect withdrawn content; this preview does not automate a separate deletion ledger. Bound backup retention and destroy expired snapshots; do not promise erasure from all copies.

The real automated restore drill creates a synthetic contribution, reviews/publishes its factual projection, stops the app, snapshots, restores to a distinct directory, opens a new HTTP server, reads restored private sanitized evidence and public projection, uses the original receipt to withdraw, and verifies restored image files were deleted. It tests local copies, not offsite disaster recovery.

## Verification and remaining gates

Run `npm test` and `npm audit --omit=dev`. `tests/tdd-evidence.md` records observed vertical RED/GREEN cycles; `tests/latest-test-output.txt` is the final captured run. Tests use actual loopback HTTP, actual SQLite, actual sharp decoding, generated images with synthetic EXIF and temporary isolated directories. Includes restart persistence, MIME/pixel/byte/count rejection, EXIF removal, authorization, origin/host/traversal protection, pause/quotas/queue/body limits, concurrent idempotency, concurrent queue cap, stale-admin withdrawal race, publication evidence audit, receipt erasure, backup/restore and a spawned real CLI process.

**Not public-ready:** decoder runs in-process (no OS sandbox), no MFA/RBAC, no authenticated reviewer roster, no independent moderation/redaction quality check, no contact-based receipt recovery, no automated retention/backup/deletion-ledger/incident paging, no offsite recovery drill, no disk quota or scheduled orphan-file sweep, no multiprocess coordination, no pagination beyond the admin limit. Abrupt process/power loss during image persistence may leave orphan sanitized files; graceful shutdown is not a draining transaction coordinator. No disk-encryption or secure physical deletion guarantee. Rate limits reset on restart; local intake is not internet abuse protection. JSON text is untrusted: frontend must render with textContent, never raw HTML. Operator rights/privacy notices, accountable reviewer, incident handling and exact-version public release authorization remain separate gates. Do not tunnel or deploy this preview to collect real submissions.
