import { test } from "node:test";
import assert from "node:assert/strict";
import { request } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdtemp, cp, appendFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startTestPostgres, startService } from "./postgres-harness.ts";
import { postgresDatabase } from "../src/database.ts";
import { migrate } from "../src/migrations.ts";

await test(
  "two service processes share durable PostgreSQL state and serialize duplicate intents",
  { timeout: 60000 },
  async (t) => {
    const pg = await startTestPostgres();
    const clients: Awaited<ReturnType<typeof request.newContext>>[] = [];
    let a: Awaited<ReturnType<typeof startService>> | undefined;
    let b: Awaited<ReturnType<typeof startService>> | undefined;
    try {
      // Exercise concurrent migration runners before starting independent services.
      const one = postgresDatabase(pg.url),
        two = postgresDatabase(pg.url);
      try {
        await Promise.all([migrate(one), migrate(two)]);
        assert.equal(
          (
            await one.query<{ count: number }>(
              "SELECT count(*)::int AS count FROM schema_migrations",
            )
          ).rows[0]?.count,
          2,
        );
      } finally {
        await one.close();
        await two.close();
      }
      [a, b] = await Promise.all([startService(pg.url), startService(pg.url)]);
      const first = await request.newContext({ baseURL: a.url }),
        second = await request.newContext({ baseURL: b.url });
      clients.push(first, second);
      const auth = async (client: typeof first) => {
        const response = await client.post("/sessions", {
          data: {
            tenant: "alpha",
            role: "editor",
            password: "demo-only-password",
          },
        });
        assert.equal(response.status(), 201);
        return { Authorization: "Bearer " + (await response.json()).token };
      };
      const headersA = await auth(first),
        headersB = await auth(second),
        key = randomUUID();
      let id = "";
      await t.test(
        "simultaneous identical requests commit once across processes",
        async () => {
          const results = await Promise.all([
            first.post("/reservations", {
              headers: { ...headersA, "Idempotency-Key": key },
              data: { sku: "camera-kit", quantity: 2 },
            }),
            second.post("/reservations", {
              headers: { ...headersB, "Idempotency-Key": key },
              data: { sku: "camera-kit", quantity: 2 },
            }),
          ]);
          assert.deepEqual(results.map((r) => r.status()).sort(), [200, 201]);
          const records = await Promise.all(results.map((r) => r.json()));
          assert.deepEqual(records[0], records[1]);
          id = records[0].id;
          assert.equal(
            (
              await (
                await first.get("/inventory", { headers: headersA })
              ).json()
            ).available,
            3,
          );
        },
      );
      await t.test(
        "different intents with one key conflict without consuming stock",
        async () => {
          const result = await second.post("/reservations", {
            headers: { ...headersB, "Idempotency-Key": key },
            data: { sku: "camera-kit", quantity: 1 },
          });
          assert.equal(result.status(), 409);
          assert.equal(
            (
              await (
                await first.get("/inventory", { headers: headersA })
              ).json()
            ).available,
            3,
          );
        },
      );
      await t.test("competing unique reservations never oversell", async () => {
        const results = await Promise.all([
          first.post("/reservations", {
            headers: { ...headersA, "Idempotency-Key": randomUUID() },
            data: { sku: "camera-kit", quantity: 2 },
          }),
          second.post("/reservations", {
            headers: { ...headersB, "Idempotency-Key": randomUUID() },
            data: { sku: "camera-kit", quantity: 2 },
          }),
        ]);
        assert.deepEqual(results.map((r) => r.status()).sort(), [201, 409]);
        assert.equal(
          (await (await first.get("/inventory", { headers: headersA })).json())
            .available,
          1,
        );
      });
      await t.test(
        "database restart preserves records and allows pool recovery",
        async () => {
          await pg.restart();
          const result = await second.get("/reservations/" + id, {
            headers: headersB,
          });
          assert.equal(result.status(), 200);
          assert.equal((await result.json()).id, id);
          const replay = await first.post("/reservations", {
            headers: { ...headersA, "Idempotency-Key": key },
            data: { sku: "camera-kit", quantity: 2 },
          });
          assert.equal(replay.status(), 200);
          assert.equal(
            (
              await (
                await first.get("/inventory", { headers: headersA })
              ).json()
            ).available,
            1,
          );
        },
      );
      await t.test("changed applied migration is rejected", async () => {
        const dir = await mkdtemp(join(tmpdir(), "qe-migration-"));
        const db = postgresDatabase(pg.url);
        try {
          await cp(new URL("../migrations/", import.meta.url), dir, {
            recursive: true,
          });
          await appendFile(
            join(dir, "001-initial.sql"),
            "\n-- deliberate checksum fault\n",
          );
          await assert.rejects(migrate(db, dir), /checksum changed/);
        } finally {
          await db.close();
          await rm(dir, { recursive: true, force: true });
        }
      });
    } finally {
      for (const c of clients) await c.dispose();
      await a?.stop();
      await b?.stop();
      await pg.stop();
    }
  },
);
