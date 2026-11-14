import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Database } from "./database.ts";

export async function migrate(
  db: Database,
  directory = fileURLToPath(new URL("../migrations/", import.meta.url)),
) {
  const names = (await readdir(directory))
    .filter((n) => /^\d{3}-[a-z-]+\.sql$/.test(n))
    .sort();
  if (!names.length) throw new Error("No migration files found.");
  for (const name of names) {
    const sql = await readFile(join(directory, name), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    await db.transaction(async (tx) => {
      // Serialize migration runners before even creating the ledger table.
      if (db.kind === "postgres")
        await tx.query("SELECT pg_advisory_xact_lock(4310001)");
      await tx.query(
        "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL)",
      );
      const result = await tx.query<{ checksum: string }>(
        "SELECT checksum FROM schema_migrations WHERE name=$1",
        [name],
      );
      if (result.rows[0]) {
        if (result.rows[0].checksum !== checksum)
          throw new Error("Applied migration checksum changed: " + name);
        return;
      }
      await tx.exec(sql);
      await tx.query(
        "INSERT INTO schema_migrations (name, checksum) VALUES ($1,$2)",
        [name, checksum],
      );
    });
  }
}
