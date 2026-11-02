import { randomUUID } from "node:crypto";
import { Ajv } from "ajv";
import { test, expect, login, assertForeignDenied } from "./fixtures.ts";
import {
  validReservation,
  type Tenant,
  type Role,
} from "../contracts/schemas.ts";
const input = { sku: "camera-kit", quantity: 1 };

for (const tenant of ["alpha", "beta"] as const)
  for (const role of ["editor", "viewer"] as const) {
    test(`${tenant} ${role}: enforce role and tenant boundaries`, async ({
      api,
    }) => {
      const headers = await login(api, tenant, role);
      const created = await api.post("/reservations", {
        headers: { ...headers, "Idempotency-Key": randomUUID() },
        data: input,
      });
      expect(created.status()).toBe(role === "editor" ? 201 : 403);
      const listed = await api.get("/reservations", { headers });
      expect(listed.status()).toBe(200);
      expect((await listed.json()).total).toBe(role === "editor" ? 1 : 0);
      if (role === "viewer") {
        expect(
          await (await api.get("/inventory", { headers })).json(),
        ).toMatchObject({ available: 5 });
        return;
      }
      const record = await created.json();
      expect(validReservation(record)).toBe(true);
      const foreignTenant: Tenant = tenant === "alpha" ? "beta" : "alpha";
      for (const foreignRole of [
        "editor",
        "viewer",
      ] as const satisfies readonly Role[]) {
        const outsider = await login(api, foreignTenant, foreignRole);
        await assertForeignDenied(
          await api.get("/reservations/" + record.id, { headers: outsider }),
        );
        expect(
          (await (await api.get("/reservations", { headers: outsider })).json())
            .total,
        ).toBe(0);
      }
      const viewer = await login(api, tenant, "viewer");
      expect(
        await (
          await api.get("/reservations/" + record.id, { headers: viewer })
        ).json(),
      ).toEqual(record);
    });
  }

test("unauthenticated, unknown, revoked and malformed tokens are denied", async ({
  api,
}) => {
  for (const headers of [
    {},
    { Authorization: "Bearer " + randomUUID() },
    { Authorization: "Basic demo" },
  ]) {
    expect((await api.get("/reservations", { headers })).status()).toBe(401);
    expect(
      (await api.post("/reservations", { headers, data: input })).status(),
    ).toBe(401);
  }
  const headers = await login(api, "alpha", "editor");
  expect((await api.delete("/sessions", { headers })).status()).toBe(204);
  expect((await api.get("/reservations", { headers })).status()).toBe(401);
});

test("bad credentials and caller-supplied tenant overrides are rejected", async ({
  api,
}) => {
  expect(
    (
      await api.post("/sessions", {
        data: { tenant: "alpha", role: "editor", password: "wrong" },
      })
    ).status(),
  ).toBe(401);
  expect(
    (
      await api.post("/sessions", {
        data: {
          tenant: "gamma",
          role: "editor",
          password: "demo-only-password",
        },
      })
    ).status(),
  ).toBe(400);
  const headers = {
    ...(await login(api, "alpha", "editor")),
    "Idempotency-Key": randomUUID(),
  };
  expect(
    (
      await api.post("/reservations", {
        headers,
        data: { ...input, tenantId: "beta" },
      })
    ).status(),
  ).toBe(400);
  expect(
    (await (await api.get("/reservations", { headers })).json()).total,
  ).toBe(0);
});

test("duplicate concurrent requests consume inventory once", async ({
  api,
}) => {
  const headers = {
    ...(await login(api, "alpha", "editor")),
    "Idempotency-Key": randomUUID(),
  };
  const responses = await Promise.all([
    api.post("/reservations", { headers, data: input }),
    api.post("/reservations", { headers, data: input }),
  ]);
  expect(responses.map((r) => r.status()).sort()).toEqual([200, 201]);
  expect(responses.map((r) => r.headers()["idempotent-replay"]).sort()).toEqual(
    ["false", "true"],
  );
  expect(await responses[0]!.json()).toEqual(await responses[1]!.json());
  expect(await (await api.get("/inventory", { headers })).json()).toMatchObject(
    { available: 4 },
  );
  expect(
    (await (await api.get("/reservations", { headers })).json()).total,
  ).toBe(1);
});

test("same key conflicts on changed intent and is scoped to the tenant", async ({
  api,
}) => {
  const key = randomUUID();
  const alpha = {
    ...(await login(api, "alpha", "editor")),
    "Idempotency-Key": key,
  };
  const beta = {
    ...(await login(api, "beta", "editor")),
    "Idempotency-Key": key,
  };
  expect(
    (await api.post("/reservations", { headers: alpha, data: input })).status(),
  ).toBe(201);
  expect(
    (
      await api.post("/reservations", {
        headers: alpha,
        data: { ...input, quantity: 2 },
      })
    ).status(),
  ).toBe(409);
  expect(
    (await api.post("/reservations", { headers: beta, data: input })).status(),
  ).toBe(201);
  expect(
    await (await api.get("/inventory", { headers: alpha })).json(),
  ).toMatchObject({ available: 4 });
});

test("new session reads durable tenant records rather than a per-login dataset", async ({
  api,
}) => {
  const first = await login(api, "alpha", "editor");
  const record = await (
    await api.post("/reservations", {
      headers: { ...first, "Idempotency-Key": randomUUID() },
      data: input,
    })
  ).json();
  await api.delete("/sessions", { headers: first });
  const second = await login(api, "alpha", "editor");
  expect(
    await (
      await api.get("/reservations/" + record.id, { headers: second })
    ).json(),
  ).toEqual(record);
});

test("insufficient stock rolls back without reserving a failed key", async ({
  api,
}) => {
  const headers = await login(api, "alpha", "editor");
  expect(
    (
      await api.post("/reservations", {
        headers: { ...headers, "Idempotency-Key": randomUUID() },
        data: { ...input, quantity: 4 },
      })
    ).status(),
  ).toBe(201);
  const key = randomUUID();
  expect(
    (
      await api.post("/reservations", {
        headers: { ...headers, "Idempotency-Key": key },
        data: { ...input, quantity: 2 },
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await api.post("/reservations", {
        headers: { ...headers, "Idempotency-Key": key },
        data: input,
      })
    ).status(),
  ).toBe(201);
  expect(await (await api.get("/inventory", { headers })).json()).toMatchObject(
    { available: 0 },
  );
  expect(
    (await (await api.get("/reservations", { headers })).json()).total,
  ).toBe(2);
});

test("invalid input, media types, body size and request keys do not write data", async ({
  api,
}) => {
  const auth = await login(api, "alpha", "editor");
  const headers = { ...auth, "Idempotency-Key": randomUUID() };
  for (const data of [
    {},
    null,
    [],
    { ...input, quantity: 0 },
    { ...input, quantity: 1.5 },
    { ...input, quantity: "1" },
    { ...input, sku: "' OR 1=1 --" },
    { ...input, extra: true },
  ]) {
    expect(
      (
        await api.post("/reservations", {
          headers: { ...headers, "Content-Type": "application/json" },
          data: JSON.stringify(data),
        })
      ).status(),
    ).toBe(400);
  }
  expect(
    (
      await api.post("/reservations", {
        headers: { ...headers, "Content-Type": "application/json" },
        data: "{",
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await api.post("/reservations", {
        headers: { ...headers, "Content-Type": "text/plain" },
        data: "x",
      })
    ).status(),
  ).toBe(415);
  expect(
    (
      await api.post("/reservations", {
        headers: { ...headers, "Content-Type": "application/json" },
        data: "x".repeat(9000),
      })
    ).status(),
  ).toBe(413);
  expect(
    (await api.post("/reservations", { headers: auth, data: input })).status(),
  ).toBe(400);
  expect(
    (
      await api.post("/reservations", {
        headers: { ...auth, "Idempotency-Key": "bad" },
        data: input,
      })
    ).status(),
  ).toBe(400);
  expect(
    (await (await api.get("/reservations", { headers })).json()).total,
  ).toBe(0);
});

test("pagination rejects ambiguous queries and preserves tenant boundaries", async ({
  api,
}) => {
  const headers = await login(api, "alpha", "editor");
  for (let i = 0; i < 3; i++)
    expect(
      (
        await api.post("/reservations", {
          headers: { ...headers, "Idempotency-Key": randomUUID() },
          data: input,
        })
      ).status(),
    ).toBe(201);
  expect(
    await (
      await api.get("/reservations?page=2&pageSize=2", { headers })
    ).json(),
  ).toMatchObject({ total: 3, page: 2, items: [input] });
  for (const query of [
    "page=0",
    "page=1&page=2",
    "pageSize=11",
    "page=1.5",
    "tenant=beta",
    "page=99",
  ])
    expect(
      (await api.get("/reservations?" + query, { headers })).status(),
    ).toBe(400);
});

test("foreign browser origin is denied before a write", async ({ api }) => {
  const headers = {
    ...(await login(api, "alpha", "editor")),
    "Idempotency-Key": randomUUID(),
    Origin: "https://untrusted.example",
  };
  expect(
    (await api.post("/reservations", { headers, data: input })).status(),
  ).toBe(403);
  expect(
    (await (await api.get("/reservations", { headers })).json()).total,
  ).toBe(0);
});

test("published response contract validates a real record and catches field faults", async ({
  api,
}) => {
  const spec = await (await api.get("/openapi.json")).json();
  const validate = new Ajv({ strict: true }).compile(
    spec.paths["/reservations"].post.responses["201"].content[
      "application/json"
    ].schema,
  );
  const headers = {
    ...(await login(api, "alpha", "editor")),
    "Idempotency-Key": randomUUID(),
  };
  const record = await (
    await api.post("/reservations", { headers, data: input })
  ).json();
  expect(validate(record)).toBe(true);
  const { tenantId: _tenant, ...missing } = record;
  for (const faulty of [
    missing,
    { ...record, quantity: "1" },
    { ...record, internalKey: "should-not-leak" },
  ])
    expect(validate(faulty)).toBe(false);
});

test("ownership assertion rejects a deliberately unscoped lookup", async ({
  api,
  store,
}) => {
  const owner = {
    ...(await login(api, "alpha", "editor")),
    "Idempotency-Key": randomUUID(),
  };
  const record = await (
    await api.post("/reservations", { headers: owner, data: input })
  ).json();
  const outsider = await login(api, "beta", "editor");
  const original = store.get.bind(store);
  store.get = async (_tenant, id) => original("alpha", id);
  try {
    const leaked = await api.get("/reservations/" + record.id, {
      headers: outsider,
    });
    await expect(assertForeignDenied(leaked)).rejects.toThrow();
  } finally {
    store.get = original;
  }
  await assertForeignDenied(
    await api.get("/reservations/" + record.id, { headers: outsider }),
  );
});

test("internal errors return 500 without exposing database details", async ({
  api,
  store,
}) => {
  const headers = await login(api, "alpha", "viewer");
  const original = store.available.bind(store);
  store.available = async () => {
    throw new Error("synthetic database credential detail");
  };
  try {
    const response = await api.get("/inventory", { headers });
    expect(response.status()).toBe(500);
    expect(await response.json()).toEqual({
      error: "Internal service failure.",
    });
  } finally {
    store.available = original;
  }
});

test("malformed record IDs and unsupported methods do not expose SQL failures", async ({
  api,
}) => {
  const headers = await login(api, "alpha", "editor");
  const invalid = await api.get("/reservations/" + "-".repeat(36), { headers });
  expect(invalid.status()).toBe(404);
  expect(await invalid.json()).toEqual({ error: "Not found." });
  const unsupported = await api.patch("/reservations", {
    headers,
    data: input,
  });
  expect(unsupported.status()).toBe(405);
  expect(unsupported.headers().allow).toBe("GET, POST");
  expect(
    (await (await api.get("/reservations", { headers })).json()).total,
  ).toBe(0);
});
