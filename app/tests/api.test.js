import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir, readFile, cp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
const SCRATCH =
  process.env.TMPDIR ||
  path.join(os.homedir(), "AppData/Local/hermes/cache/scratch");
const ROOT = path.resolve("backend");
test("semantic idempotency ignores JSON object key ordering", async (t) => {
  const s = await setup(t);
  const p = await fixture();
  const h = { "Idempotency-Key": "canonical-fixture-key" };
  const first = await s.api("/api/submissions", p, h);
  const reverse = Object.fromEntries(Object.entries(p).reverse());
  assert.equal((await s.api("/api/submissions", reverse, h)).status, 200);
  assert.equal(
    (await s.api("/api/admin/submissions", undefined, auth)).data.items[0].id,
    first.data.id,
  );
});
test("genuine PNG accepts blank optional fields, rejects disguised SVG and records submission time", async (t) => {
  const s = await setup(t);
  const p = await fixture();
  for (const k of ["city", "barcode", "nafdac"]) p[k] = "";
  const bytes = await sharp({
    create: { width: 3, height: 3, channels: 3, background: "blue" },
  })
    .png()
    .toBuffer();
  p.images = [
    {
      role: "front",
      dataUrl: "data:image/png;base64," + bytes.toString("base64"),
    },
  ];
  assert.equal((await s.api("/api/submissions", p)).status, 201);
  const row = (await s.api("/api/admin/submissions", undefined, auth)).data
    .items[0];
  assert.ok(!Number.isNaN(Date.parse(row.submission.receivedAt)));
  p.images[0].dataUrl =
    "data:image/png;base64," +
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
    ).toString("base64");
  assert.equal((await s.api("/api/submissions", p)).status, 400);
});
test("withdrawal prevents old idempotency key from recreating deleted evidence", async (t) => {
  const s = await setup(t);
  const p = await fixture();
  const headers = { "Idempotency-Key": "withdraw-fixture-key" };
  const r = await s.api("/api/submissions", p, headers);
  await s.api("/api/withdraw", {
    id: r.data.id,
    receiptToken: r.data.receiptToken,
  });
  assert.equal((await s.api("/api/submissions", p, headers)).status, 409);
  assert.deepEqual(await readdir(path.join(s.dir, "images")), []);
});
test("publication persists named reviewer, exact evidence map and attestation privately", async (t) => {
  const s = await setup(t);
  const r = await s.api("/api/submissions", await fixture());
  const route = "/api/admin/submissions/" + r.data.id;
  await s.api(route, { action: "review", reviewer: "Fixture Reviewer" }, auth);
  const fields = { productName: "Fixture facts", market: "Nigeria" },
    evidence = { productName: 0, market: 0 };
  await s.api(
    route,
    {
      action: "publish",
      reviewer: "Fixture Reviewer",
      attestedFromImages: true,
      publicFields: fields,
      evidence,
    },
    auth,
  );
  await s.app.close();
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path.join(s.dir, "submissions.sqlite"));
  try {
    const row = db
      .prepare("SELECT detail FROM audit WHERE action='publish'")
      .get();
    assert.deepEqual(JSON.parse(row.detail), {
      publicFields: fields,
      evidence,
      attestedFromImages: true,
    });
  } finally {
    db.close();
  }
});
test("concurrent intake cannot exceed queue cap", async (t) => {
  const s = await setup(t, { queueCap: 1 });
  const p = await fixture();
  const rs = await Promise.all([
    s.api("/api/submissions", p),
    s.api("/api/submissions", p),
  ]);
  assert.deepEqual(rs.map((r) => r.status).sort(), [201, 503]);
});
test("slow admin mutation cannot resurrect an already withdrawn submission", async (t) => {
  const s = await setup(t);
  const r = await s.api("/api/submissions", await fixture());
  const { request } = await import("node:http");
  const body = JSON.stringify({
    action: "review",
    reviewer: "Fixture Reviewer",
  });
  let finish;
  const response = new Promise((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port: s.app.server.address().port,
        path: "/api/admin/submissions/" + r.data.id,
        method: "POST",
        headers: {
          ...auth,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on("error", reject);
    req.write(body.slice(0, 5));
    finish = () => req.end(body.slice(5));
  });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(
    (
      await s.api("/api/withdraw", {
        id: r.data.id,
        receiptToken: r.data.receiptToken,
      })
    ).status,
    200,
  );
  finish();
  assert.equal(await response, 409);
  assert.equal(
    (await s.api("/api/admin/submissions", undefined, auth)).data.items[0]
      .state,
    "withdrawn",
  );
});
test("static exact allowlist serves assets without traversal or private files", async (t) => {
  const root = await mkdtemp(path.join(SCRATCH, "nutri-static-fixture-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { writeFile } = await import("node:fs/promises");
  await writeFile(
    path.join(root, "index.html"),
    "<!doctype html><title>SYNTHETIC FIXTURE</title>",
  );
  await writeFile(path.join(root, "main.mjs"), "// SYNTHETIC FIXTURE");
  await writeFile(path.join(root, "secret.txt"), "PRIVATE");
  const s = await setup(t, { publicDir: root });
  const port = s.app.server.address().port;
  const base = `http://127.0.0.1:${port}`;
  assert.equal((await fetch(base + "/")).status, 200);
  assert.match(
    (await fetch(base + "/main.mjs")).headers.get("content-type"),
    /javascript/,
  );
  for (const p of [
    "/secret.txt",
    "/%2e%2e/backend/core.js",
    "/images/x.png",
    "/main.mjs/extra",
    "/submissions.sqlite",
  ])
    assert.equal((await fetch(base + p)).status, 404);
  assert.equal(
    await new Promise((resolve, reject) => {
      import("node:http").then(({ get }) =>
        get(
          base + "/api/status",
          { headers: { Host: "evil.example" } },
          (r) => {
            r.resume();
            resolve(r.statusCode);
          },
        ).on("error", reject),
      );
    }),
    403,
  );
});
test("real stopped backup restores SQLite, sanitized images, projection and receipt withdrawal", async (t) => {
  const s = await setup(t);
  const r = await s.api("/api/submissions", await fixture());
  const reviewRoute = "/api/admin/submissions/" + r.data.id;
  assert.equal(
    (
      await s.api(
        reviewRoute,
        { action: "review", reviewer: "Backup Fixture Reviewer" },
        auth,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await s.api(
        reviewRoute,
        {
          action: "publish",
          reviewer: "Backup Fixture Reviewer",
          attestedFromImages: true,
          publicFields: {
            productName: "Restored synthetic facts",
            market: "Nigeria",
          },
          evidence: { productName: 0, market: 0 },
        },
        auth,
      )
    ).status,
    200,
  );
  const { backupStopped, restoreStopped } = await import(
    "../backend/backup.js"
  );
  const backup = s.dir + "-snapshot",
    restored = s.dir + "-restored";
  let restoredApp;
  t.after(async () => {
    await restoredApp?.close();
    await rm(backup, { recursive: true, force: true });
    await rm(restored, { recursive: true, force: true });
  });
  await s.app.close();
  await backupStopped(s.dir, backup);
  await restoreStopped(backup, restored);
  const { createApp } = await import("../backend/app.js");
  const a = (restoredApp = await createApp({
    dataDir: restored,
    adminToken: TOKEN,
  }));
  await new Promise((r) => a.server.listen(0, "127.0.0.1", r));
  t.after(() => a.close());
  const base = `http://127.0.0.1:${a.server.address().port}`;
  const rows = await (
    await fetch(base + "/api/admin/submissions", { headers: auth })
  ).json();
  assert.equal(rows.items[0].id, r.data.id);
  assert.equal(
    (await (await fetch(base + "/api/catalogue")).json()).items[0].productName,
    "Restored synthetic facts",
  );
  const image = await fetch(
    base + "/api/admin/submissions/" + r.data.id + "/images/0",
    { headers: auth },
  );
  assert.equal(image.status, 200);
  assert.equal(
    (await sharp(Buffer.from(await image.arrayBuffer())).metadata()).exif,
    undefined,
  );
  const del = await fetch(base + "/api/withdraw", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: r.data.id, receiptToken: r.data.receiptToken }),
  });
  assert.equal(del.status, 200);
  assert.deepEqual(await readdir(path.join(restored, "images")), []);
});
test("named review publishes only evidenced allowed facts and receipt withdrawal erases content/files with tombstone", async (t) => {
  const s = await setup(t);
  const r = await s.api("/api/submissions", await fixture());
  const id = r.data.id;
  const endpoint = "/api/admin/submissions/" + id;
  assert.equal(
    (await s.api(endpoint, { action: "review", reviewer: "Fixture Reviewer" }))
      .status,
    401,
  );
  assert.equal(
    (
      await s.api(
        endpoint,
        { action: "publish", reviewer: "Fixture Reviewer" },
        auth,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await s.api(
        endpoint,
        { action: "review", reviewer: "Fixture Reviewer" },
        auth,
      )
    ).status,
    200,
  );
  const publication = {
    action: "publish",
    reviewer: "Fixture Reviewer",
    attestedFromImages: true,
    publicFields: {
      productName: "Fixture facts",
      brand: "Fixture",
      market: "Nigeria",
      capturedOn: "2026-11-01",
    },
    evidence: { productName: 0, brand: 0, market: 0, capturedOn: 0 },
  };
  assert.equal(
    (
      await s.api(
        endpoint,
        {
          ...publication,
          publicFields: { ...publication.publicFields, receiptToken: "leak" },
        },
        auth,
      )
    ).status,
    400,
  );
  assert.equal((await s.api(endpoint, publication, auth)).status, 200);
  const pub = (await s.api("/api/catalogue")).data.items[0];
  assert.equal(pub.productName, "Fixture facts");
  assert.equal(pub.physicalAuthenticity, "not_assessed");
  assert.equal(pub.images, undefined);
  assert.equal(pub.city, undefined);
  const route = endpoint + "/images/0";
  assert.equal((await s.api(route)).status, 401);
  assert.equal(
    (await s.api(endpoint + "/images/999", undefined, auth)).status,
    404,
  );
  assert.equal(
    (await s.api("/api/withdraw", { id, receiptToken: "wrong" })).status,
    404,
  );
  assert.equal(
    (await s.api("/api/withdraw", { id, receiptToken: r.data.receiptToken }))
      .status,
    200,
  );
  assert.deepEqual(await readdir(path.join(s.dir, "images")), []);
  assert.deepEqual((await s.api("/api/catalogue")).data.items, [
    { id, state: "withdrawn" },
  ]);
  const row = (await s.api("/api/admin/submissions", undefined, auth)).data
    .items[0];
  assert.equal(row.submission, null);
  assert.deepEqual(row.images, []);
  assert.equal(
    (await s.api("/api/withdraw", { id, receiptToken: r.data.receiptToken }))
      .status,
    404,
  );
});
test("admin absent/short token fails closed and reject/admin-withdraw paths require reviewer", async (t) => {
  const absent = await setup(t, { adminToken: "" });
  assert.equal(
    (await absent.api("/api/admin/submissions", undefined, auth)).status,
    401,
  );
  const s = await setup(t);
  const r = await s.api("/api/submissions", await fixture());
  const route = "/api/admin/submissions/" + r.data.id;
  assert.equal((await s.api(route, { action: "reject" }, auth)).status, 400);
  assert.equal(
    (
      await s.api(
        route,
        { action: "reject", reviewer: "Fixture Reviewer" },
        auth,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await s.api(
        route,
        { action: "withdraw", reviewer: "Fixture Reviewer" },
        auth,
      )
    ).status,
    200,
  );
  assert.deepEqual(await readdir(path.join(s.dir, "images")), []);
});
test("idempotency serializes concurrent retries, conflicts, survives restart and never replays secret", async (t) => {
  const s = await setup(t);
  const p = await fixture();
  const headers = { "Idempotency-Key": "concurrent-synthetic-key" };
  const results = await Promise.all([
    s.api("/api/submissions", p, headers),
    s.api("/api/submissions", p, headers),
  ]);
  assert.deepEqual(results.map((x) => x.status).sort(), [200, 201]);
  assert.equal(new Set(results.map((x) => x.data.id)).size, 1);
  assert.equal(
    results.find((x) => x.status === 200).data.receiptToken,
    undefined,
  );
  assert.equal((await readdir(path.join(s.dir, "images"))).length, 1);
  await s.restart();
  assert.equal((await s.api("/api/submissions", p, headers)).status, 200);
  assert.equal(
    (await s.api("/api/submissions", { ...p, brand: "Changed" }, headers))
      .status,
    409,
  );
});
test("strict intake rejects fake MIME, excess pixels/bytes/count, unsupported nutrition, missing attestations and cross-origin writes", async (t) => {
  const s = await setup(t);
  const good = await fixture();
  for (const edit of [
    (p) => (p.rightsAccepted = false),
    (p) => (p.adultConfirmed = false),
    (p) => (p.nutrition = { fat: 1 }),
    (p) => (p.images = Array(5).fill(p.images[0])),
    (p) =>
      (p.images[0].dataUrl = p.images[0].dataUrl.replace(
        "image/jpeg",
        "image/png",
      )),
    (p) => (p.images[0].dataUrl = "https://example.com/a.png"),
    (p) => (p.capturedOn = "2026-02-31"),
    (p) =>
      (p.images[0].dataUrl =
        "data:image/png;base64," +
        Buffer.alloc(8 * 1024 * 1024 + 1).toString("base64")),
  ]) {
    const p = structuredClone(good);
    edit(p);
    assert.equal((await s.api("/api/submissions", p)).status, 400);
  }
  const huge = await sharp({
    create: { width: 5000, height: 4001, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  const p = structuredClone(good);
  p.images[0].dataUrl = "data:image/png;base64," + huge.toString("base64");
  assert.equal((await s.api("/api/submissions", p)).status, 400);
  assert.equal(
    (await s.api("/api/submissions", good, { Origin: "https://evil.example" }))
      .status,
    403,
  );
  assert.equal((await readdir(path.join(s.dir, "images"))).length, 0);
});
test("pause, bounded quota, queue cap and body cap are enforced", async (t) => {
  const paused = await setup(t, { intakePaused: true });
  assert.equal((await paused.api("/api/status")).data.intake, "paused");
  assert.equal(
    (await paused.api("/api/submissions", await fixture())).status,
    503,
  );
  const quota = await setup(t, { rateLimit: 1 });
  assert.equal(
    (await quota.api("/api/submissions", await fixture())).status,
    201,
  );
  assert.equal(
    (await quota.api("/api/submissions", await fixture())).status,
    429,
  );
  const capped = await setup(t, { queueCap: 1, maxBody: 2048 });
  assert.equal(
    (await capped.api("/api/submissions", await fixture())).status,
    201,
  );
  assert.equal(
    (await capped.api("/api/submissions", await fixture())).status,
    503,
  );
  const body = await setup(t, { maxBody: 10 });
  assert.equal(
    (await body.api("/api/submissions", await fixture())).status,
    413,
  );
});
test("intake persists sanitized private evidence across restart without public leakage", async (t) => {
  const s = await setup(t);
  const payload = await fixture();
  const r = await s.api("/api/submissions", payload, {
    "Idempotency-Key": "synthetic-key-0001",
  });
  assert.equal(r.status, 201);
  assert.equal(r.data.state, "received_private");
  assert.ok(r.data.receiptToken.length >= 40);
  await s.restart();
  const rows = (await s.api("/api/admin/submissions", undefined, auth)).data
    .items;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, r.data.id);
  assert.equal(JSON.stringify(rows).includes(r.data.receiptToken), false);
  const files = await readdir(path.join(s.dir, "images"));
  assert.equal(files.length, 1);
  const meta = await sharp(
    await readFile(path.join(s.dir, "images", files[0])),
  ).metadata();
  assert.equal(meta.exif, undefined);
  assert.equal(meta.format, "png");
  assert.deepEqual((await s.api("/api/catalogue")).data, { items: [] });
  const disk = await readFile(path.join(s.dir, "submissions.sqlite"));
  assert.equal(disk.includes(Buffer.from(r.data.receiptToken)), false);
  assert.equal((await s.api("/images/" + files[0])).status, 404);
});
const TOKEN = "synthetic-admin-fixture-".repeat(3);
async function setup(t, options = {}) {
  const dir = await mkdtemp(path.join(SCRATCH, "nutri-fixture-"));
  const { createApp } = await import("../backend/app.js");
  let app = await createApp({ dataDir: dir, adminToken: TOKEN, ...options });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  let base = `http://127.0.0.1:${app.server.address().port}`;
  const api = async (p, body, headers = {}) => {
    const r = await fetch(base + p, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, headers: r.headers, data: await r.json() };
  };
  t.after(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });
  return {
    dir,
    api,
    get app() {
      return app;
    },
    restart: async () => {
      await app.close();
      app = await createApp({ dataDir: dir, adminToken: TOKEN, ...options });
      await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
      base = `http://127.0.0.1:${app.server.address().port}`;
    },
  };
}
async function fixture() {
  const buf = await sharp({
    create: { width: 30, height: 20, channels: 3, background: "orange" },
  })
    .jpeg()
    .withExif({ IFD0: { Artist: "SYNTHETIC FIXTURE PRIVATE METADATA" } })
    .toBuffer();
  return {
    productName: "SYNTHETIC TEST LABEL — NOT A FOOD RECORD",
    brand: "Fixture",
    market: "Nigeria",
    city: "Fixture city",
    capturedOn: "2026-11-01",
    rightsAccepted: true,
    adultConfirmed: true,
    termsVersion: "pilot-v1",
    images: [
      {
        role: "front",
        dataUrl: "data:image/jpeg;base64," + buf.toString("base64"),
      },
    ],
  };
}
const auth = { Authorization: `Bearer ${TOKEN}` };
test("local status and empty catalogue are honest and guarded", async (t) => {
  const s = await setup(t);
  const r = await s.api("/api/status");
  assert.equal(r.status, 200);
  assert.equal(r.data.mode, "local-preview");
  assert.equal(r.data.intake, "open");
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual((await s.api("/api/catalogue")).data, { items: [] });
  assert.equal((await s.api("/api/admin/submissions")).status, 401);
  assert.equal((await s.api("/../backend/app.js")).status, 404);
});
