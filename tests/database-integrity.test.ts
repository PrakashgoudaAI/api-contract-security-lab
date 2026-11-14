import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, cp, rm, writeFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { postgresDatabase, type Database } from "../src/database.ts";
import { ReservationStore } from "../src/store.ts";
import { migrate } from "../src/migrations.ts";
import { startTestPostgres } from "./postgres-harness.ts";

await test(
  "PostgreSQL snapshot pagination and forward-only migration integrity",
  { timeout: 60000 },
  async (t) => {
    const cluster = await startTestPostgres();
    const db = postgresDatabase(cluster.url),
      writerDb = postgresDatabase(cluster.url);
    const directory = await mkdtemp(join(tmpdir(), "qe-integrity-"));
    try {
      await migrate(db);
      const writer = new ReservationStore(writerDb);
      await t.test(
        "page items and total use one snapshot while a separate connection commits",
        async () => {
          let inserted = false;
          const interleaved: Database = {
            ...db,
            transaction: (work, options) =>
              db.transaction(
                (tx) =>
                  work({
                    ...tx,
                    query: async <Row extends Record<string, unknown>>(
                      sql: string,
                      values?: unknown[],
                    ) => {
                      const result = await tx.query<Row>(sql, values);
                      if (sql.includes("SELECT count(*)") && !inserted) {
                        inserted = true;
                        await writer.create("alpha", randomUUID(), {
                          sku: "camera-kit",
                          quantity: 1,
                        });
                      }
                      return result;
                    },
                  }),
                options,
              ),
          };
          const during = await new ReservationStore(interleaved).list(
            "alpha",
            1,
            10,
          );
          assert.equal(inserted, true);
          assert.equal(during.total, 0);
          assert.deepEqual(during.items, []);
          const after = await new ReservationStore(db).list("alpha", 1, 10);
          assert.equal(after.total, 1);
          assert.equal(after.items.length, 1);
          await assert.rejects(
            new ReservationStore(db).list("alpha", 2, 10),
            /outside/,
          );
        },
      );
      await cp(new URL("../migrations/", import.meta.url), directory, {
        recursive: true,
      });
      await t.test("missing previously applied file is rejected", async () => {
        await rm(join(directory, "001-initial.sql"));
        await assert.rejects(migrate(db, directory), /Missing or reordered/);
        await cp(
          new URL("../migrations/001-initial.sql", import.meta.url),
          join(directory, "001-initial.sql"),
        );
      });
      await t.test(
        "duplicate migration numbers and backfilled files fail before application",
        async () => {
          const file = join(directory, "002-duplicate.sql");
          await writeFile(file, "CREATE TABLE should_not_exist(id int);");
          await assert.rejects(migrate(db, directory), /duplicate/);
          await rm(file);
          await rename(
            join(directory, "001-initial.sql"),
            join(directory, "000-initial.sql"),
          );
          await assert.rejects(migrate(db, directory), /Invalid/);
          await rename(
            join(directory, "000-initial.sql"),
            join(directory, "001-initial.sql"),
          );
          await rename(
            join(directory, "002-reservation-order.sql"),
            join(directory, "003-reservation-order.sql"),
          );
          await assert.rejects(migrate(db, directory), /Missing or reordered/);
          await rename(
            join(directory, "003-reservation-order.sql"),
            join(directory, "002-reservation-order.sql"),
          );
          const table = await db.query<{ present: string | null }>(
            "SELECT to_regclass('should_not_exist')::text AS present",
          );
          assert.equal(table.rows[0]?.present, null);
        },
      );
      await t.test(
        "a valid forward migration applies once and rolls back a failed plan",
        async () => {
          await writeFile(
            join(directory, "003-marker.sql"),
            "CREATE TABLE migration_marker(id int PRIMARY KEY);",
          );
          await Promise.all([
            migrate(db, directory),
            migrate(writerDb, directory),
          ]);
          assert.equal(
            (
              await db.query<{ count: number }>(
                "SELECT count(*)::int AS count FROM schema_migrations",
              )
            ).rows[0]?.count,
            3,
          );
          await writeFile(
            join(directory, "004-transaction.sql"),
            "CREATE TABLE rollback_marker(id int);",
          );
          await writeFile(
            join(directory, "005-broken.sql"),
            "THIS IS NOT VALID SQL;",
          );
          await assert.rejects(migrate(db, directory));
          assert.equal(
            (
              await db.query<{ present: string | null }>(
                "SELECT to_regclass('rollback_marker')::text AS present",
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
            3,
          );
        },
      );
    } finally {
      await db.close();
      await writerDb.close();
      await cluster.stop();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
