import { generateKeyPair, SignJWT } from "jose";
import { test, expect } from "./fixtures.ts";
import { createApp } from "../src/server.ts";
import { jwtAuthenticator } from "../src/jwt.ts";
import { Sessions } from "../src/auth.ts";
import { once } from "node:events";
import { randomUUID } from "node:crypto";

test("issuer-mode HTTP authorization rejects invalid claims and preserves tenant boundaries", async ({
  playwright,
  store,
}) => {
  const keys = await generateKeyPair("ES256"),
    wrong = await generateKeyPair("ES256");
  const now = Date.UTC(2026, 0, 1) / 1000;
  const sign = async (
    claims: Record<string, unknown> = {},
    key = keys.privateKey,
  ) =>
    new SignJWT({ tenant: "alpha", role: "editor", ...claims })
      .setProtectedHeader({ alg: "ES256" })
      .setIssuer("https://issuer.example.test")
      .setAudience("reservation-api")
      .setSubject("synthetic-user")
      .setIssuedAt(now)
      .setExpirationTime(now + 60)
      .sign(key);
  const signed = async (
    changes: {
      issuer?: string;
      audience?: string;
      expires?: number;
      notBefore?: number;
    } = {},
    key = keys.privateKey,
  ) => {
    let jwt = new SignJWT({ tenant: "alpha", role: "editor" })
      .setProtectedHeader({ alg: "ES256" })
      .setIssuer(changes.issuer ?? "https://issuer.example.test")
      .setAudience(changes.audience ?? "reservation-api")
      .setSubject("synthetic-user")
      .setIssuedAt(now)
      .setExpirationTime(changes.expires ?? now + 60);
    if (changes.notBefore !== undefined)
      jwt = jwt.setNotBefore(changes.notBefore);
    return jwt.sign(key);
  };
  const server = createApp(store, new Sessions(), {
    authenticate: jwtAuthenticator(
      keys.publicKey,
      "https://issuer.example.test",
      "reservation-api",
      () => new Date(now * 1000),
    ),
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing address.");
  const api = await playwright.request.newContext({
    baseURL: `http://127.0.0.1:${address.port}`,
  });
  try {
    expect(
      (
        await api.post("/sessions", {
          data: {
            tenant: "alpha",
            role: "editor",
            password: "demo-only-password",
          },
        })
      ).status(),
    ).toBe(405);
    const invalid = [
      await signed({ issuer: "https://other.example.test" }),
      await signed({ audience: "other-api" }),
      await signed({ expires: now }),
      await signed({ notBefore: now + 10 }),
      await signed({}, wrong.privateKey),
      await sign({ tenant: "gamma" }),
      await sign({ role: "admin" }),
      "unsigned.payload.value",
    ];
    for (const token of invalid)
      expect(
        (
          await api.get("/inventory", {
            headers: { Authorization: "Bearer " + token },
          })
        ).status(),
      ).toBe(401);
    const owner = {
      Authorization: "Bearer " + (await sign()),
      "Idempotency-Key": randomUUID(),
    };
    const created = await api.post("/reservations", {
      headers: owner,
      data: { sku: "camera-kit", quantity: 1 },
    });
    expect(created.status()).toBe(201);
    const record = await created.json();
    const outsider = {
      Authorization: "Bearer " + (await sign({ tenant: "beta" })),
    };
    expect(
      (
        await api.get("/reservations/" + record.id, { headers: outsider })
      ).status(),
    ).toBe(404);
    const viewer = {
      Authorization: "Bearer " + (await sign({ role: "viewer" })),
      "Idempotency-Key": randomUUID(),
    };
    expect(
      (
        await api.post("/reservations", {
          headers: viewer,
          data: { sku: "camera-kit", quantity: 1 },
        })
      ).status(),
    ).toBe(403);
    expect(
      (await (await api.get("/inventory", { headers: owner })).json())
        .available,
    ).toBe(4);
  } finally {
    await api.dispose();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }
});
