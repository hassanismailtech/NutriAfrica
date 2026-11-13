// Offline-only snapshots: stop the application before calling either function.
import { cp, mkdir, access } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
async function copyStopped(source, destination) {
  await access(path.join(source, "submissions.sqlite"));
  await mkdir(destination, { recursive: false, mode: 0o700 });
  await cp(
    path.join(source, "submissions.sqlite"),
    path.join(destination, "submissions.sqlite"),
    { errorOnExist: true, force: false },
  );
  await cp(path.join(source, "images"), path.join(destination, "images"), {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  const db = new DatabaseSync(path.join(destination, "submissions.sqlite"));
  try {
    if (db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok")
      throw new Error("Snapshot integrity check failed");
  } finally {
    db.close();
  }
}
export const backupStopped = copyStopped;
export const restoreStopped = copyStopped;
