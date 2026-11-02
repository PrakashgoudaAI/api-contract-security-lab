import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../src/store.ts";
const input = { sku: "camera-kit", quantity: 1 };

await test("filesystem database preserves records, inventory and replay keys across reopening", async () => {
  const dir = await mkdtemp(join(tmpdir(), "reservation-restart-"));
  let store = await openStore(join(dir, "pg"));
  try {
    const first = await store.create("alpha", "durable-request-01", input);
    await store.close();
    store = await openStore(join(dir, "pg"));
    assert.deepEqual(await store.get("alpha", first.record.id), first.record);
    assert.equal(await store.available("alpha"), 4);
    assert.deepEqual(await store.create("alpha", "durable-request-01", input), {
      record: first.record,
      replay: true,
    });
    await assert.rejects(store.get("beta", first.record.id));
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
await test("database constraint failure rolls back stock and does not reserve the request key", async () => {
  const store = await openStore("memory://");
  try {
    // Bypass HTTP validation deliberately to exercise the database constraint/rollback.
    await assert.rejects(
      store.create("alpha", "rollback-request-01", { ...input, quantity: -1 }),
    );
    assert.equal(await store.available("alpha"), 5);
    assert.equal((await store.list("alpha", 1, 2)).total, 0);
    const created = await store.create("alpha", "rollback-request-01", input);
    assert.equal(created.replay, false);
    assert.equal(await store.available("alpha"), 4);
  } finally {
    await store.close();
  }
});
await test("competing reservations cannot drive inventory negative", async () => {
  const store = await openStore("memory://");
  try {
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, (_, i) =>
        store.create("alpha", "competing-request-" + i, {
          ...input,
          quantity: 2,
        }),
      ),
    );
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 2);
    assert.equal(results.filter((r) => r.status === "rejected").length, 2);
    assert.equal(await store.available("alpha"), 1);
    assert.equal((await store.list("alpha", 1, 10)).total, 2);
  } finally {
    await store.close();
  }
});
