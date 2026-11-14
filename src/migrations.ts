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
    .filter((n) => /\.sql$/i.test(n))
    .sort();
  if (!names.length) throw new Error("No migration files found.");
  const versions = new Set<string>();
  const plan: { name: string; sql: string; checksum: string }[] = [];
  for (const name of names) {
    const match = /^(\d{3})-[a-z-]+\.sql$/.exec(name);
    if (!match || match[1] === "000" || versions.has(match[1]!))
      throw new Error("Invalid or duplicate migration version: " + name);
    versions.add(match[1]!);
    const sql = await readFile(join(directory, name), "utf8");
    plan.push({
      name,
      sql,
      checksum: createHash("sha256").update(sql).digest("hex"),
    });
  }
  // Validate and apply one immutable plan under the same transaction/runner lock.
  await db.transaction(async (tx) => {
    if (db.kind === "postgres")
      await tx.query("SELECT pg_advisory_xact_lock(4310001)");
    await tx.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL)",
    );
    const applied = await tx.query<{ name: string; checksum: string }>(
      "SELECT name, checksum FROM schema_migrations ORDER BY name",
    );
    for (const [i, entry] of applied.rows.entries()) {
      const file = plan[i];
      if (!file || file.name !== entry.name)
        throw new Error(
          "Missing or reordered applied migration: " + entry.name,
        );
      if (file.checksum !== entry.checksum)
        throw new Error("Applied migration checksum changed: " + entry.name);
    }
    for (const file of plan.slice(applied.rows.length)) {
      await tx.exec(file.sql);
      await tx.query(
        "INSERT INTO schema_migrations (name, checksum) VALUES ($1,$2)",
        [file.name, file.checksum],
      );
    }
  });
}
