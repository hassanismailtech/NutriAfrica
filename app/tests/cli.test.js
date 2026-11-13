import { test } from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
test("CLI starts a real loopback-only empty local preview and stops cleanly", async (t) => {
  const scratch =
    process.env.TMPDIR ||
    path.join(os.homedir(), "AppData/Local/hermes/cache/scratch");
  await mkdir(scratch, { recursive: true });
  const dir = await mkdtemp(path.join(scratch, "nutri-cli-fixture-"));
  const child = fork(path.resolve("backend/server.js"), [], {
    silent: true,
    env: {
      ...process.env,
      PORT: "0",
      DATA_DIR: dir,
      HOST: "0.0.0.0",
      ADMIN_TOKEN: "",
      INTAKE_PAUSED: "1",
    },
  });
  let output = "";
  child.stdout.on("data", (c) => (output += c));
  child.stderr.on("data", (c) => (output += c));
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill();
      await new Promise((r) => child.once("exit", r));
    }
    await rm(dir, { recursive: true, force: true });
  });
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("CLI did not become ready: " + output)),
      8000,
    );
    child.once("message", (m) => {
      clearTimeout(timer);
      resolve(m);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error("CLI exited " + code + ": " + output));
    });
  });
  assert.equal(ready.host, "127.0.0.1");
  const base = `http://127.0.0.1:${ready.port}`;
  const status = await (await fetch(base + "/api/status")).json();
  assert.equal(status.mode, "local-preview");
  assert.equal(status.intake, "paused");
  assert.deepEqual(await (await fetch(base + "/api/catalogue")).json(), {
    items: [],
  });
  assert.equal(output.includes("ADMIN_TOKEN"), false);
  child.send({ action: "stop" });
  await new Promise((r) => child.once("exit", r));
  assert.equal(child.exitCode, 0);
});
