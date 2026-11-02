import {
  test as base,
  expect,
  type APIRequestContext,
  type APIResponse,
} from "@playwright/test";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server.ts";
import { openStore, type ReservationStore } from "../src/store.ts";
import type { Tenant, Role } from "../contracts/schemas.ts";

type Fixtures = { api: APIRequestContext; store: ReservationStore };
export const test = base.extend<Fixtures>({
  store: async ({}, use) => {
    const dir = await mkdtemp(join(tmpdir(), "reservation-test-"));
    const store = await openStore(join(dir, "pg"));
    try {
      await use(store);
    } finally {
      await store.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
  api: async ({ playwright, store }, use) => {
    const server = createApp(store);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing test address.");
    const api = await playwright.request.newContext({
      baseURL: `http://127.0.0.1:${address.port}`,
      timeout: 5000,
    });
    try {
      await use(api);
    } finally {
      await api.dispose();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
    }
  },
});
export { expect };
export async function login(
  api: APIRequestContext,
  tenant: Tenant,
  role: Role,
) {
  const result = await api.post("/sessions", {
    data: { tenant, role, password: "demo-only-password" },
  });
  expect(result.status()).toBe(201);
  const { token } = (await result.json()) as { token: string };
  return { Authorization: "Bearer " + token };
}
export async function assertForeignDenied(response: APIResponse) {
  expect(response.status()).toBe(404);
  expect(await response.json()).toEqual({ error: "Reservation not found." });
}
