import EmbeddedPostgres from "embedded-postgres";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

export async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No local port assigned.");
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}
export async function startTestPostgres() {
  const dir = await mkdtemp(join(tmpdir(), "qe-pg-"));
  const port = await freePort();
  const password = randomUUID();
  const cluster = new EmbeddedPostgres({
    databaseDir: join(dir, "db"),
    user: "postgres",
    password,
    port,
    persistent: true,
    authMethod: "scram-sha-256",
    createPostgresUser: false,
    postgresFlags: ["-h", "127.0.0.1", "-k", dir],
    onLog: () => {},
    onError: () => {},
  });
  try {
    await cluster.initialise();
    await cluster.start();
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
  return {
    url: `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`,
    restart: async () => {
      await cluster.stop();
      await cluster.start();
    },
    stop: async () => {
      await cluster.stop();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
export async function startService(databaseUrl: string) {
  const port = await freePort();
  const child = spawn(process.execPath, ["src/main.ts"], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    env: { ...process.env, DATABASE_URL: databaseUrl, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output = (output + String(chunk)).slice(-2000);
  });
  child.stderr.on("data", (chunk) => {
    output = (output + String(chunk)).slice(-2000);
  });
  const url = `http://127.0.0.1:${port}`;
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null)
        throw new Error("Service exited before readiness: " + output);
      try {
        if (
          (await fetch(url + "/health", { signal: AbortSignal.timeout(200) }))
            .ok
        )
          return {
            url,
            stop: async () => {
              if (child.exitCode !== null) return;
              const stopped = new Promise<void>((resolve) =>
                child.once("exit", () => resolve()),
              );
              child.kill("SIGTERM");
              const timeout = setTimeout(() => child.kill("SIGKILL"), 6000);
              try {
                await stopped;
              } finally {
                clearTimeout(timeout);
              }
            },
          };
      } catch {}
      await delay(100);
    }
    throw new Error("Service readiness timed out.");
  } catch (error) {
    child.kill("SIGKILL");
    throw error;
  }
}
