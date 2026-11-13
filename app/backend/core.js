import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import {
  randomUUID,
  randomBytes,
  createHash,
  timingSafeEqual,
} from "node:crypto";
import sharp from "sharp";
const canonical = (x) =>
  Array.isArray(x)
    ? x.map(canonical)
    : x && typeof x === "object"
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((k) => [k, canonical(x[k])]),
        )
      : x;
const hash = (x) => createHash("sha256").update(x).digest("hex");
const equal = (a, b) =>
  timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));
const fail = (code = 400) => {
  throw Object.assign(new Error("Request rejected"), { code });
};
const keys = (obj, allowed) =>
  obj &&
  typeof obj === "object" &&
  !Array.isArray(obj) &&
  Object.keys(obj).every((k) => allowed.includes(k));
const text = (v, max, required = false) =>
  typeof v === "string" &&
  v.length <= max &&
  (!required || v.trim().length > 0) &&
  !/[\u0000-\u001f]/.test(v);
function validate(body) {
  if (
    !keys(body, [
      "productName",
      "brand",
      "market",
      "city",
      "barcode",
      "nafdac",
      "capturedOn",
      "rightsAccepted",
      "adultConfirmed",
      "termsVersion",
      "images",
    ])
  )
    fail();
  for (const [k, n] of Object.entries({
    productName: 180,
    brand: 120,
    city: 80,
    barcode: 40,
    nafdac: 80,
  }))
    if (
      (body[k] !== undefined || ["productName", "brand"].includes(k)) &&
      !text(body[k], n, k === "productName")
    )
      fail();
  if (
    body.market !== "Nigeria" ||
    body.rightsAccepted !== true ||
    body.adultConfirmed !== true ||
    body.termsVersion !== "pilot-v1"
  )
    fail();
  if (
    typeof body.capturedOn !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(body.capturedOn) ||
    Number.isNaN(Date.parse(body.capturedOn)) ||
    new Date(body.capturedOn).toISOString().slice(0, 10) !== body.capturedOn ||
    body.capturedOn > new Date().toISOString().slice(0, 10)
  )
    fail();
  if (
    !Array.isArray(body.images) ||
    body.images.length < 1 ||
    body.images.length > 4
  )
    fail();
}
async function sanitize(img) {
  if (
    !keys(img, ["role", "dataUrl"]) ||
    !["front", "nutrition", "ingredients", "barcode"].includes(img.role) ||
    typeof img.dataUrl !== "string"
  )
    fail();
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
    img.dataUrl,
  );
  if (!match || match[2].length > Math.ceil((8 * 1024 * 1024) / 3) * 4) fail();
  const input = Buffer.from(match[2], "base64");
  if (input.length > 8 * 1024 * 1024 || input.toString("base64") !== match[2])
    fail();
  try {
    const decoder = sharp(input, {
      limitInputPixels: 20000000,
      failOn: "warning",
    });
    const meta = await decoder.metadata();
    if (
      meta.format !== match[1] ||
      (meta.pages || 1) !== 1 ||
      meta.width * meta.height > 20000000
    )
      fail();
    const bytes = await decoder
      .rotate()
      .png()
      .timeout({ seconds: 5 })
      .toBuffer();
    if (bytes.length > 8 * 1024 * 1024) fail();
    return { bytes, role: img.role };
  } catch {
    fail();
  }
}
async function readJson(req, max) {
  if (
    !/^application\/json(?:\s*;.*)?$/i.test(req.headers["content-type"] || "")
  )
    fail(415);
  if (Number(req.headers["content-length"]) > max) fail(413);
  let total = 0;
  const chunks = [];
  for await (const c of req) {
    total += c.length;
    if (total > max) fail(413);
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks));
  } catch {
    fail();
  }
}
export async function createApp(options = {}) {
  const adminToken = options.adminToken || "";
  const imageDir = path.join(options.dataDir, "images");
  await mkdir(imageDir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(options.dataDir, "submissions.sqlite"));
  db.exec(
    `PRAGMA secure_delete=ON; PRAGMA journal_mode=DELETE; CREATE TABLE IF NOT EXISTS submissions(id TEXT PRIMARY KEY,state TEXT NOT NULL,receiptHash TEXT,body TEXT,images TEXT,projection TEXT);`,
  );
  const limits = new Map();
  let active = 0;
  let writeTail = Promise.resolve();
  db.exec(
    "CREATE TABLE IF NOT EXISTS idempotency(keyHash TEXT PRIMARY KEY,payloadHash TEXT NOT NULL,id TEXT NOT NULL)",
  );
  db.exec(
    "CREATE TABLE IF NOT EXISTS audit(id TEXT, action TEXT, reviewer TEXT, at TEXT, detail TEXT)",
  );
  if (
    !db
      .prepare("PRAGMA table_info(audit)")
      .all()
      .some((c) => c.name === "detail")
  )
    db.exec("ALTER TABLE audit ADD COLUMN detail TEXT");
  async function withdraw(row) {
    db.prepare(
      "UPDATE submissions SET state='withdrawing',body=NULL,receiptHash=NULL,projection=? WHERE id=?",
    ).run(JSON.stringify({ id: row.id, state: "withdrawn" }), row.id);
    for (const img of JSON.parse(row.images || "[]"))
      await unlink(path.join(imageDir, img.name)).catch((e) => {
        if (e.code !== "ENOENT") throw e;
      });
    db.prepare(
      "UPDATE submissions SET state='withdrawn',images='[]' WHERE id=?",
    ).run(row.id);
    db.prepare("UPDATE idempotency SET payloadHash='' WHERE id=?").run(row.id);
    db.prepare("UPDATE audit SET detail=NULL WHERE id=?").run(row.id);
  }
  for (const row of db
    .prepare("SELECT * FROM submissions WHERE state='withdrawing'")
    .all())
    await withdraw(row);
  const server = http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data: blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    const send = (code, data) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };
    const url = req.url;
    try {
      const own = `127.0.0.1:${server.address().port}`;
      if (req.headers.host !== own) fail(403);
      if (
        req.method !== "GET" &&
        ((req.headers.origin && req.headers.origin !== `http://${own}`) ||
          req.headers["sec-fetch-site"] === "cross-site")
      )
        fail(403);
      if (
        url.startsWith("/api/admin/") &&
        (adminToken.length < 32 ||
          !equal(req.headers.authorization || "", `Bearer ${adminToken}`))
      )
        fail(401);
      if (req.method === "GET" && url === "/api/status")
        return send(200, {
          mode: "local-preview",
          intake: options.intakePaused ? "paused" : "open",
          termsVersion: "pilot-v1",
          nutrition: "not_supported",
          images: "private_only",
        });
      if (req.method === "GET" && url === "/api/catalogue")
        return send(200, {
          items: db
            .prepare(
              "SELECT projection FROM submissions WHERE projection IS NOT NULL",
            )
            .all()
            .map((x) => JSON.parse(x.projection)),
        });
      if (req.method === "POST" && url === "/api/withdraw") {
        const b = await readJson(req, 4096);
        if (
          !keys(b, ["id", "receiptToken"]) ||
          !text(b.id, 36, true) ||
          !text(b.receiptToken, 128, true)
        )
          fail();
        const row = db
          .prepare("SELECT * FROM submissions WHERE id=?")
          .get(b.id);
        if (!row?.receiptHash || !equal(hash(b.receiptToken), row.receiptHash))
          fail(404);
        await withdraw(row);
        return send(200, { id: row.id, state: "withdrawn" });
      }
      const adminRoute =
        /^\/api\/admin\/submissions\/([a-f0-9-]{36})(?:\/images\/(0|[1-9][0-9]?))?$/.exec(
          url,
        );
      if (adminRoute) {
        let row = db
          .prepare("SELECT * FROM submissions WHERE id=?")
          .get(adminRoute[1]);
        if (!row) fail(404);
        if (req.method === "GET" && adminRoute[2] !== undefined) {
          const img = JSON.parse(row.images || "[]")[Number(adminRoute[2])];
          if (!img || row.state === "withdrawing") fail(404);
          const bytes = await readFile(path.join(imageDir, img.name));
          res.writeHead(200, {
            "Content-Type": "image/png",
            "Content-Disposition": "inline",
          });
          return res.end(bytes);
        }
        if (req.method === "POST" && adminRoute[2] === undefined) {
          const b = await readJson(req, 16384);
          if (
            !keys(b, [
              "action",
              "reviewer",
              "attestedFromImages",
              "publicFields",
              "evidence",
            ]) ||
            !text(b.reviewer, 120, true) ||
            !["review", "reject", "publish", "withdraw"].includes(b.action)
          )
            fail();
          row = db
            .prepare("SELECT * FROM submissions WHERE id=?")
            .get(adminRoute[1]);
          if (["withdrawn", "withdrawing"].includes(row.state)) fail(409);
          let state =
            b.action === "review"
              ? "human_review"
              : b.action === "reject"
                ? "rejected"
                : b.action === "publish"
                  ? "published"
                  : "withdrawn";
          let projection = null;
          if (b.action === "publish") {
            const source = JSON.parse(row.body);
            const images = JSON.parse(row.images);
            const fields = b.publicFields;
            const allowed = [
              "productName",
              "brand",
              "market",
              "barcode",
              "nafdac",
            ];
            // Capture date comes from the observation, never represented as transcribed pack text.
            allowed.push("capturedOn");
            if (
              !source?.rightsAccepted ||
              !source.adultConfirmed ||
              source.termsVersion !== "pilot-v1" ||
              !["human_review", "published"].includes(row.state) ||
              b.attestedFromImages !== true ||
              !keys(fields, allowed) ||
              !text(fields.productName, 180, true) ||
              fields.market !== "Nigeria" ||
              !keys(b.evidence, allowed) ||
              images.length === 0
            )
              fail();
            for (const [k, v] of Object.entries(fields)) {
              const max = {
                productName: 180,
                brand: 120,
                market: 7,
                barcode: 40,
                nafdac: 80,
                capturedOn: 10,
              }[k];
              if (!text(v, max)) fail();
              const idx = b.evidence[k];
              if (!Number.isInteger(idx) || idx < 0 || idx >= images.length)
                fail();
            }
            if (
              fields.capturedOn !== undefined &&
              fields.capturedOn !== source.capturedOn
            )
              fail();
            projection = {
              id: row.id,
              state: "published",
              ...fields,
              method: "label",
              transcription: "human_reviewed",
              registryLookup: "not_attempted",
              physicalAuthenticity: "not_assessed",
              allergens: "unknown",
              nutrition: "not_documented",
              rights: "approved_facts_only",
            };
          }
          if (b.action === "withdraw") await withdraw(row);
          else
            db.prepare(
              "UPDATE submissions SET state=?,projection=? WHERE id=?",
            ).run(
              state,
              projection ? JSON.stringify(projection) : null,
              row.id,
            );
          db.prepare("INSERT INTO audit VALUES(?,?,?,?,?)").run(
            row.id,
            b.action,
            b.reviewer,
            new Date().toISOString(),
            b.action === "publish"
              ? JSON.stringify({
                  publicFields: b.publicFields,
                  evidence: b.evidence,
                  attestedFromImages: true,
                })
              : null,
          );
          return send(200, { id: row.id, state });
        }
      }
      if (req.method === "GET" && url === "/api/admin/submissions")
        return send(200, {
          items: db
            .prepare("SELECT * FROM submissions LIMIT 1000")
            .all()
            .map((x) => ({
              id: x.id,
              state: x.state,
              submission: JSON.parse(x.body),
              images: JSON.parse(x.images),
            })),
        });
      if (req.method === "POST" && url === "/api/submissions") {
        if (options.intakePaused) fail(503);
        if (active >= 2) fail(503);
        const now = Date.now();
        for (const [k, v] of limits)
          if (now - v.start > 3600000) limits.delete(k);
        const ip = req.socket.remoteAddress;
        if (!limits.has(ip)) {
          if (limits.size >= 1024) fail(429);
          limits.set(ip, { start: now, n: 0 });
        }
        const rate = limits.get(ip);
        if (++rate.n > (options.rateLimit ?? 30)) fail(429);
        active++;
        const written = [];
        let unlock;
        try {
          const body = await readJson(req, options.maxBody ?? 35 * 1024 * 1024);
          validate(body);
          const key = req.headers["idempotency-key"];
          if (key !== undefined && !/^[A-Za-z0-9_-]{8,128}$/.test(key)) fail();
          const keyHash = key ? hash(key) : null;
          const payloadHash = hash(JSON.stringify(canonical(body)));
          const previous = writeTail;
          writeTail = new Promise((r) => {
            unlock = r;
          });
          await previous;
          if (keyHash) {
            const seen = db
              .prepare("SELECT * FROM idempotency WHERE keyHash=?")
              .get(keyHash);
            if (seen) {
              if (seen.payloadHash !== payloadHash) fail(409);
              const old = db
                .prepare("SELECT state FROM submissions WHERE id=?")
                .get(seen.id);
              return send(200, {
                id: seen.id,
                state: old.state,
                replayed: true,
              });
            }
          }
          if (
            db
              .prepare(
                "SELECT count(*) AS n FROM submissions WHERE state IN ('received_private','human_review')",
              )
              .get().n >= (options.queueCap ?? 500)
          )
            fail(503);
          const sanitized = [];
          for (const img of body.images) sanitized.push(await sanitize(img));
          const id = randomUUID();
          const token = randomBytes(32).toString("base64url");
          const images = [];
          for (const img of sanitized) {
            const name = randomUUID() + ".png";
            await writeFile(path.join(imageDir, name), img.bytes, {
              mode: 0o600,
              flag: "wx",
            });
            written.push(name);
            images.push({ name, role: img.role, digest: hash(img.bytes) });
          }
          delete body.images;
          body.receivedAt = new Date().toISOString();
          db.exec("BEGIN IMMEDIATE");
          try {
            db.prepare("INSERT INTO submissions VALUES(?,?,?,?,?,NULL)").run(
              id,
              "received_private",
              hash(token),
              JSON.stringify(body),
              JSON.stringify(images),
            );
            if (keyHash)
              db.prepare("INSERT INTO idempotency VALUES(?,?,?)").run(
                keyHash,
                payloadHash,
                id,
              );
            db.exec("COMMIT");
          } catch (e) {
            db.exec("ROLLBACK");
            throw e;
          }
          written.length = 0;
          return send(201, {
            id,
            receiptToken: token,
            state: "received_private",
          });
        } finally {
          active--;
          for (const name of written)
            await unlink(path.join(imageDir, name)).catch(() => {});
          unlock?.();
        }
      }
      const staticFiles = {
        "/": "index.html",
        "/index.html": "index.html",
        "/style.css": "style.css",
        "/ui-model.mjs": "ui-model.mjs",
        "/main.mjs": "main.mjs",
        "/plex-regular.ttf": "plex-regular.ttf",
        "/plex-medium.ttf": "plex-medium.ttf",
        "/plex-semibold.ttf": "plex-semibold.ttf",
        "/admin.html": "admin.html",
        "/admin.mjs": "admin.mjs",
      };
      if (
        req.method === "GET" &&
        Object.hasOwn(staticFiles, url) &&
        options.publicDir
      ) {
        try {
          const file = staticFiles[url];
          const bytes = await readFile(path.join(options.publicDir, file));
          const mime = file.endsWith(".mjs")
            ? "text/javascript; charset=utf-8"
            : file.endsWith(".css")
              ? "text/css; charset=utf-8"
              : file.endsWith(".ttf")
                ? "font/ttf"
                : "text/html; charset=utf-8";
          res.writeHead(200, { "Content-Type": mime });
          return res.end(bytes);
        } catch (e) {
          if (e.code !== "ENOENT") throw e;
        }
      }
      send(404, { error: "Not found" });
    } catch (e) {
      send(Number.isInteger(e.code) ? e.code : 500, {
        error: Number.isInteger(e.code) ? "Request rejected" : "Internal error",
      });
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.timeout = 35000;
  server.maxConnections = 32;
  let closing;
  return {
    server,
    close: () =>
      (closing ??= new Promise((r) => {
        server.close(() => {
          db.close();
          r();
        });
        server.closeAllConnections();
      })),
  };
}
