import { test } from "node:test";
import assert from "node:assert/strict";
import { Sessions } from "../src/auth.ts";
import { Problem } from "../src/problem.ts";
const unauthorized = (error: unknown) =>
  error instanceof Problem && error.status === 401;

await test("sessions expire at the exact lifetime boundary", () => {
  let now = 0;
  const sessions = new Sessions(() => now);
  const token = sessions.issue("alpha", "editor");
  now = 899_999;
  assert.equal(sessions.authenticate("Bearer " + token).tenant, "alpha");
  now = 900_000;
  assert.throws(() => sessions.authenticate("Bearer " + token), unauthorized);
});
await test("revocation affects one session and identity snapshots cannot change authorization", () => {
  const sessions = new Sessions();
  const first = sessions.issue("alpha", "viewer");
  const second = sessions.issue("beta", "editor");
  const copy = sessions.authenticate("Bearer " + first);
  copy.role = "editor";
  assert.equal(sessions.authenticate("Bearer " + first).role, "viewer");
  sessions.revoke("Bearer " + first);
  assert.throws(() => sessions.authenticate("Bearer " + first), unauthorized);
  assert.equal(sessions.authenticate("Bearer " + second).tenant, "beta");
});
await test("session capacity is bounded and expired sessions are reclaimed", () => {
  let now = 0;
  const sessions = new Sessions(() => now);
  for (let i = 0; i < 1000; i++) sessions.issue("alpha", "viewer");
  assert.throws(
    () => sessions.issue("alpha", "viewer"),
    (error: unknown) => error instanceof Problem && error.status === 503,
  );
  now = 900_000;
  assert.ok(sessions.issue("beta", "editor"));
});
