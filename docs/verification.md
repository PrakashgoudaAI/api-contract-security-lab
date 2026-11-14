# Verification record

Verified locally on 2 November 2026 using Node.js 24.4.0 on macOS (Apple M4 Pro, 12 logical CPUs).

`npm run verify` passed after the PostgreSQL, signed-token and consumer additions:

- TypeScript, promise-handling lint and source formatting checks passed.
- Six unit tests passed.
- Eighteen Playwright API tests passed, with retries disabled.
- Six PostgreSQL tests passed (including the parent suite): concurrent migration startup, requests through two independent Node service processes, replay/conflicting intent, competing stock reservations, database restart recovery and migration checksum rejection.
- Two consumer contract tests passed. A real dashboard client generated a Pact interaction; verification replayed it against the service. Parser negative controls rejected renamed fields, string quantities and negative stock.

A source-only copy in a directory containing a space also passed `npm ci` and the full verification command with fresh dependencies.

The database tests start a native PostgreSQL server in a test-owned temporary directory. They use loopback, generated credentials and no operating-system user creation. This is real client/server SQL; it is still one host and does not demonstrate network partition recovery or crash durability. Restart coverage is an orderly stop/start. PGlite remains the zero-server default for interactive use.

The first public milestone's GitHub run passed: [API invariants run](https://github.com/PrakashgoudaAI/api-contract-security-lab/actions/runs/41473128245). That run predates these additions. Linux execution of the expanded milestone must be assessed from its own hosted run.

## Read workload baseline

`npm run benchmark` starts a fresh PostgreSQL database and two service processes. It warms up with 20 reads, then sends 200 inventory reads at concurrency four, alternating between processes. Every response must have status 200 and the expected stock. Successful samples, error count, elapsed time and host details are written to ignored `reports/load-baseline.json`.

One local execution completed 200 reads with zero errors: elapsed 30.97 ms, p50 0.49 ms, p95 1.23 ms and p99 1.90 ms (about 6,458 requests/second over this short interval). These are loopback, warm-cache read measurements on the host above. They exclude startup and do not measure writes, saturation, remote clients or production capacity. There is no performance pass threshold or claimed improvement. Repeat runs and a representative deployment workload are needed before choosing an SLO.

## Retained reports

CI retains API JUnit/HTML and the generated consumer Pact for seven days. The Pact includes a synthetic placeholder token; the provider verifier supplies its temporary session at runtime. API traces are disabled to avoid retaining real bearer values. Test output contains no production data.

Dependency installation runs the locked native setup scripts used by embedded-postgres and Pact. The full local checks passed with these installed dependencies; native binaries and runner permissions remain platform requirements.
