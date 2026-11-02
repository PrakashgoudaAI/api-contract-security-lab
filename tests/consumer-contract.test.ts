import { test } from "node:test";
import assert from "node:assert/strict";
import { PactV3, MatchersV3, Verifier } from "@pact-foundation/pact";
import { mkdtemp, rm, mkdir, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { inventoryCard } from "../consumers/reservation-dashboard/client.ts";
import { openStore } from "../src/store.ts";
import { createApp } from "../src/server.ts";

await test(
  "dashboard consumer generates a pact that the real provider satisfies",
  { timeout: 30000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "qe-pact-"));
    const pact = new PactV3({
      consumer: "ReservationDashboard",
      provider: "ReservationAPI",
      dir,
      logLevel: "error",
    });
    pact.addInteraction({
      states: [{ description: "alpha inventory has five camera kits" }],
      uponReceiving: "a request for the inventory card",
      withRequest: {
        method: "GET",
        path: "/inventory",
        headers: { Authorization: "Bearer synthetic-contract-token" },
      },
      willRespondWith: {
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: {
          sku: MatchersV3.string("camera-kit"),
          available: 5,
        },
      },
    });
    const store = await openStore("memory://");
    const server = createApp(store);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing provider address.");
    const url = `http://127.0.0.1:${address.port}`;
    try {
      await pact.executeTest(async (mock) =>
        assert.deepEqual(
          await inventoryCard(mock.url, "synthetic-contract-token"),
          { sku: "camera-kit", remaining: 5, canReserve: true },
        ),
      );
      const session = await fetch(url + "/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant: "alpha",
          role: "viewer",
          password: "demo-only-password",
        }),
      });
      const token = (await session.json()).token as string;
      await new Verifier({
        providerBaseUrl: url,
        pactUrls: [join(dir, "ReservationDashboard-ReservationAPI.json")],
        logLevel: "error",
        stateHandlers: {
          "alpha inventory has five camera kits": async () => {
            assert.equal(await store.available("alpha"), 5);
          },
        },
        requestFilter: (
          req: { headers: Record<string, string | string[] | undefined> },
          _res: unknown,
          next: () => void,
        ) => {
          req.headers.authorization = "Bearer " + token;
          next();
        },
      }).verifyProvider();
      await mkdir("reports/pacts", { recursive: true });
      await copyFile(
        join(dir, "ReservationDashboard-ReservationAPI.json"),
        "reports/pacts/ReservationDashboard-ReservationAPI.json",
      );
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
      await store.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
);

await test("consumer rejects a breaking field rename and accepts unrelated additions", async () => {
  // Small HTTP targets exercise the actual consumer parser, not the provider schema.
  const { createServer } = await import("node:http");
  const run = async (value: unknown) => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(value));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing address.");
    try {
      return await inventoryCard(
        `http://127.0.0.1:${address.port}`,
        "synthetic-token",
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  };
  await assert.rejects(run({ sku: "camera-kit", stock: 5 }), /incompatible/);
  await assert.rejects(
    run({ sku: "camera-kit", available: "5" }),
    /incompatible/,
  );
  await assert.rejects(
    run({ sku: "camera-kit", available: -1 }),
    /incompatible/,
  );
  assert.deepEqual(
    await run({ sku: "camera-kit", available: 0, warehouse: "synthetic" }),
    { sku: "camera-kit", remaining: 0, canReserve: false },
  );
});
