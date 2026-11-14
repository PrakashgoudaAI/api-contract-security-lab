import { performance } from "node:perf_hooks";
import { cpus, platform, release } from "node:os";
import { mkdir, writeFile } from "node:fs/promises";
import { startTestPostgres, startService } from "../tests/postgres-harness.ts";

const pg = await startTestPostgres();
let a: Awaited<ReturnType<typeof startService>> | undefined;
let b: Awaited<ReturnType<typeof startService>> | undefined;
try {
  [a, b] = await Promise.all([startService(pg.url), startService(pg.url)]);
  const services = [a, b];
  const headers = await Promise.all(
    services.map(async (service) => {
      const response = await fetch(service.url + "/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant: "alpha",
          role: "viewer",
          password: "demo-only-password",
        }),
      });
      if (response.status !== 201)
        throw new Error("Benchmark setup could not authenticate.");
      return { Authorization: "Bearer " + (await response.json()).token };
    }),
  );
  const read = async (index: number) => {
    const response = await fetch(services[index]!.url + "/inventory", {
      headers: headers[index]!,
      signal: AbortSignal.timeout(3000),
    });
    const value = await response.json();
    if (
      response.status !== 200 ||
      value.sku !== "camera-kit" ||
      value.available !== 5
    )
      throw new Error("Read failed or returned invalid inventory.");
  };
  for (let i = 0; i < 20; i++) await read(i % 2);
  const samples: number[] = [];
  let next = 0,
    errors = 0;
  const started = performance.now();
  await Promise.all(
    Array.from({ length: 4 }, async (_, worker) => {
      while (true) {
        const index = next++;
        if (index >= 200) return;
        const begin = performance.now();
        try {
          await read(worker % 2);
          samples.push(performance.now() - begin);
        } catch {
          errors++;
        }
      }
    }),
  );
  const elapsedMs = performance.now() - started;
  samples.sort((x, y) => x - y);
  const percentile = (q: number) =>
    samples.length
      ? samples[
          Math.min(samples.length - 1, Math.ceil(samples.length * q) - 1)
        ]!
      : null;
  const report = {
    scenario: "read-inventory-two-service-processes",
    database: "PostgreSQL server",
    runtime: process.version,
    os: platform() + " " + release(),
    cpu: cpus()[0]?.model ?? "unknown",
    logicalCpus: cpus().length,
    warmupRequests: 20,
    concurrency: 4,
    attempts: 200,
    successes: samples.length,
    errors,
    elapsedMs,
    requestsPerSecond: 200 / (elapsedMs / 1000),
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    p99Ms: percentile(0.99),
    successfulRequestLatenciesMs: samples,
    limitations: [
      "Single developer host",
      "Read-only workload",
      "No production SLO or cross-machine comparison",
    ],
  };
  await mkdir("reports", { recursive: true });
  await writeFile(
    "reports/load-baseline.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify(
      {
        ...report,
        successfulRequestLatenciesMs: "recorded in reports/load-baseline.json",
      },
      null,
      2,
    ),
  );
  if (errors) process.exitCode = 1;
} finally {
  await a?.stop();
  await b?.stop();
  await pg.stop();
}
