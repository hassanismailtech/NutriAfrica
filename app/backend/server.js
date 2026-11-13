import { createApp } from "./app.js";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT ?? 4318);
if (!Number.isInteger(port) || port < 0 || port > 65535)
  throw new Error("Invalid PORT");
const dataDir = path.resolve(
  process.env.DATA_DIR ||
    path.join(
      process.env.LOCALAPPDATA || path.join(os.homedir(), ".local/share"),
      "NutriAfrica",
      "local-preview",
    ),
);
const publicDir = path.join(root, "public");
if (dataDir === publicDir || dataDir.startsWith(publicDir + path.sep))
  throw new Error("DATA_DIR must be outside public");
const app = await createApp({
  dataDir,
  publicDir,
  adminToken: process.env.ADMIN_TOKEN || "",
  intakePaused: process.env.INTAKE_PAUSED === "1",
});
await new Promise((resolve, reject) => {
  app.server.once("error", reject);
  app.server.listen(port, "127.0.0.1", resolve);
});
const ready = {
  mode: "local-preview",
  host: "127.0.0.1",
  port: app.server.address().port,
};
console.log(
  `NutriAfrica LOCAL PREVIEW http://${ready.host}:${ready.port} (not public-ready)`,
);
if (process.send) process.send(ready);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await app.close();
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
if (process.send)
  process.on("message", (m) => {
    if (m?.action === "stop") stop();
  });
