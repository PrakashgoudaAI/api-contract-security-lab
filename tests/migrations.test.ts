import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { embeddedDatabase } from "../src/database.ts";
import { migrate } from "../src/migrations.ts";
await test("backfilling a lower version after an applied gap is rejected without SQL effects", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qe-gap-"));
  const db = await embeddedDatabase("memory://");
  try {
    await writeFile(
      join(dir, "001-initial.sql"),
      "CREATE TABLE initial_marker(id int);",
    );
    await writeFile(
      join(dir, "003-forward.sql"),
      "CREATE TABLE forward_marker(id int);",
    );
    await migrate(db, dir);
    await writeFile(
      join(dir, "002-backfill.sql"),
      "CREATE TABLE backfill_marker(id int);",
    );
    await assert.rejects(migrate(db, dir), /Missing or reordered/);
    assert.equal(
      (
        await db.query<{ present: string | null }>(
          "SELECT to_regclass('backfill_marker')::text AS present",
        )
      ).rows[0]?.present,
      null,
    );
    assert.equal(
      (
        await db.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM schema_migrations",
        )
      ).rows[0]?.count,
      2,
    );
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
