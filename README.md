# NutriAfrica

NutriAfrica is a food-data infrastructure project exploring permissioned, evidence-backed documentation of packaged foods sold in Nigeria.

## Current state

**Local-only contribution and review pilot. Not a publicly launched database, food-safety verifier or medical product.** No real food records are bundled or seeded. Automated tests generate synthetic fixtures in isolated temporary storage.

Implemented journey:

- Submit original label photographs and product context to private storage.
- Validate and re-encode JPEG/PNG evidence, stripping identifying metadata.
- Review evidence through a protected local moderator interface.
- Publish an explicit factual projection; images remain private.
- Withdraw a contribution using its private receipt.

A label transcription is not a laboratory measurement, regulator approval or physical-pack authenticity assessment. The pilot does not calculate nutrition, make allergy assurances or collect health profiles.

## Run

Requires Node.js 24.x and npm:

```sh
cd app
npm ci --ignore-scripts
npm test
node --test ui-tests/model.test.mjs
npm start
```

Open http://127.0.0.1:4318/. The server binds only to loopback. The moderation shell is `/admin.html`; its API fails closed unless a private `ADMIN_TOKEN` is configured. Never put that token in source, URLs or client bundles.

See [app/README.md](app/README.md) for configuration, API contracts, verification, backup/restore and limitations. Browser integration scripts currently depend on a local CDP helper and installed Chrome/Edge; they are not portable CI commands yet.

## Public-release boundary

Do not tunnel or deploy this local preview for real contributions. Public collection still requires approved operating ownership, privacy/contact and contribution terms, hosted durable storage, stronger administrative authentication, upload isolation, retention/deletion handling, abuse controls and operational review coverage. Passing tests is not evidence of regulatory clearance or production readiness.

## Repository contents

The public repository contains application source, tests and setup documentation. Private research dossiers, internal operating notes, original planning documents, generated archives, dependencies, secrets and runtime evidence/data are intentionally excluded. The bundled IBM Plex font licence is in [app/public/FONT-LICENSE.txt](app/public/FONT-LICENSE.txt).
