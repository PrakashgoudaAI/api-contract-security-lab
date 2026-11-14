import { readFile } from "node:fs/promises";
import { importSPKI } from "jose";
import { jwtAuthenticator } from "./jwt.ts";
import { Sessions } from "./auth.ts";
import { openStore, openPostgresStore } from "./store.ts";
import { createApp } from "./server.ts";
const port = process.env.PORT ?? "4310";
if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535)
  throw new Error("PORT must be an integer from 1024 to 65535.");
const issuerMode = process.env.JWT_PUBLIC_KEY_FILE;
let authenticate;
if (issuerMode) {
  if (!process.env.JWT_ISSUER || !process.env.JWT_AUDIENCE)
    throw new Error("JWT_ISSUER and JWT_AUDIENCE are required in issuer mode.");
  const publicKey = await importSPKI(
    await readFile(issuerMode, "utf8"),
    "ES256",
  );
  authenticate = jwtAuthenticator(
    publicKey,
    process.env.JWT_ISSUER,
    process.env.JWT_AUDIENCE,
  );
}
const store = process.env.DATABASE_URL
  ? await openPostgresStore(process.env.DATABASE_URL)
  : await openStore(process.env.DATA_DIR ?? "./data");
const server = createApp(
  store,
  new Sessions(),
  authenticate ? { authenticate } : {},
);
server.on("error", (error) => {
  console.error("Service could not listen:", error.message);
  void store.close().finally(() => {
    process.exitCode = 1;
  });
});
server.listen(Number(port), "127.0.0.1", () =>
  console.log(`Reservation demo: http://127.0.0.1:${port}`),
);
let closing = false;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    if (closing) return;
    closing = true;
    server.close(() => {
      void store.close();
    });
    server.closeIdleConnections();
    setTimeout(() => {
      server.closeAllConnections();
    }, 5000).unref();
  });
