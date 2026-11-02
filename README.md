# API Contract and Security Lab

A local reservation service for testing tenant isolation, API contracts and transactional idempotency. Two synthetic tenants each start with five camera kits. Editors reserve stock; viewers can read their own tenant's records. A valid response from the wrong tenant is still a security failure.

The default service uses PGlite for quick local setup. A PostgreSQL adapter exercises the same SQL through two independent service processes, with versioned migrations and database-level reservation coordination. Signed-token verification and a dashboard consumer Pact add identity and compatibility checks. All data is synthetic.

## Run the checks

Use Node.js 24 and npm:

```sh
npm ci
npm run verify
```

No browser download, account, API key or external test target is needed. The full suite starts a temporary native PostgreSQL server using the locked embedded-postgres development dependency; installation runs its platform setup script. API tests start an isolated loopback service on a free port and use a temporary database per test. Node tests cover session expiry, revocation, capacity, database reopening and rollback. Retries are disabled.

For an interactive service:

```sh
npm start
```

It listens at `http://127.0.0.1:4310`. `PORT` selects another port; `DATA_DIR` selects another local database directory. The default `data/` persists across restarts. Stop the service before opening that directory from another process. Test databases are separate and cleaned up after their owning test finishes.

## Try an uncertain reservation

1. Create a demo session with `POST /sessions` using:

   ```json
   {"tenant":"alpha","role":"editor","password":"demo-only-password"}
   ```

2. Use the returned token as `Authorization: Bearer <token>`. Tokens expire after 900 seconds and are never needed in committed files.
3. Send `POST /reservations` with `Content-Type: application/json`, an `Idempotency-Key` such as `walkthrough-request-001`, and:

   ```json
   {"sku":"camera-kit","quantity":2}
   ```

4. Expect 201 and a reservation ID. Repeat the same key and payload: expect 200, `Idempotent-Replay: true`, the same record and three units remaining at `GET /inventory`.
5. Change quantity under that key: expect 409. Create a `beta` session and read the `alpha` record: expect the same 404 response as a nonexistent record.
6. Stop and restart the service, create another `alpha` session and read the ID again. Records and stock persist; old session tokens do not.

The browser-origin check is defense in depth. It does not make a demo password into secure authentication: any local caller who knows the public password can choose either synthetic tenant and role. Do not deploy this service or point it at real customer data.

## Architecture

```text
HTTP request -> demo session -> role check -> input schema
             -> transaction -> tenant-scoped record -> response schema
```

- `contracts/schemas.ts` contains request/response JSON schemas and types. Input coercion is disabled; `"1"` is not an integer.
- `contracts/openapi.ts` publishes the corresponding OpenAPI 3.1 document at `/openapi.json`.
- `src/auth.ts` owns short-lived opaque demo sessions and an injectable clock.
- `src/server.ts` owns HTTP semantics, body limits, origin checks and safe error responses.
- `src/store.ts` owns parameterized SQL, tenant predicates, stock constraints and idempotency transactions.
- `tests/fixtures.ts` owns each test service and database lifecycle. There are no shared test accounts with mutable global datasets.

The database transaction locks the tenant/SKU inventory row, checks an existing `(tenant, request_key)`, decrements stock only if enough remains, then inserts the record and fingerprint. Any failure rolls the transaction back. A replay reads the original record without another decrement. Key scope is the tenant, not the login session. PGlite serializes transactions in one process. The PostgreSQL suite separately checks two Node processes against one database.

See [the storage decision](docs/decisions/001-embedded-postgres.md) and [threat model](docs/threat-model.md).

## Evidence the tests require

- Both editor/viewer roles across both tenants, including foreign-record denial and own-tenant read access.
- Unknown, expired and revoked tokens; rejected credentials and tenant override fields.
- Concurrent duplicate HTTP requests produce one record and consume stock once.
- Changed-intent key conflicts; a failed reservation does not consume a key or stock.
- Database reopening preserves records, inventory and replay information without reseeding over existing data.
- Malformed JSON, oversized bodies, wrong media types, invalid keys and ambiguous pagination fail without writes.
- The public response schema accepts a real record and rejects missing tenant IDs, string quantities and leaked internal fields.
- A deliberate test-only removal of the tenant predicate is caught by the same ownership assertion used for the real service.
- Unexpected database failures return a generic 500 without internal details.

Schema conformance is the first contract layer. The dashboard consumer additionally generates a Pact interaction from its own HTTP client and verifies it against the provider. It currently covers the inventory card, not every endpoint.

## Reports and debugging

Playwright writes `reports/api-junit.xml` and an HTML report. View it with `npx playwright show-report`. API traces are off because they could retain bearer tokens. Node tests print their results to the console. CI stores the JUnit and HTML reports for seven days.

If setup fails, check Node's major version and run `npm run check`. The compiler enables `erasableSyntaxOnly` so unsupported Node strip-only syntax is caught before execution. If the port is occupied, choose another `PORT`; the service never reuses another process's test target. If the database is locked, stop the other process rather than deleting data. Failed test databases are temporary; the interactive database persists deliberately.

`npm run lint` checks unhandled promises. `npm run format:check` covers all project TypeScript and configuration sources. A temporary minimatch 11.0.1 override resolves [GHSA-g3hv-75wg-m249](https://github.com/isaacs/minimatch/security/advisories/GHSA-g3hv-75wg-m249) in the lint toolchain; remove it when upstream ranges resolve a patched version and rerun the checks.

## Boundaries and next milestones

The service binds only to loopback. A 5-second request/socket timeout and 8 KiB body limit bound local misuse. There is no production issuer, token refresh, TLS, rate limiting, cancellation or deployment rollback system.

### PostgreSQL and issuer mode

Set `DATABASE_URL` to use a PostgreSQL service instead of the embedded directory. Migrations run at startup and reject changed checksums. See [the coordination decision](docs/decisions/002-postgres-coordination.md). Run `npm run test:postgres` to repeat the isolated two-process checks.

Set `JWT_PUBLIC_KEY_FILE` (ES256 public PEM), `JWT_ISSUER` and `JWT_AUDIENCE` together to verify externally signed tokens. Claims must include `sub`, `iat`, `exp`, a synthetic `tenant` (`alpha`/`beta`) and `role` (`editor`/`viewer`). The algorithm is restricted to ES256; issuer, audience, expiry and not-before are checked. Public demo session issuance/revocation is disabled in this mode. Key rotation and a live identity provider are outside this exercise.

`npm run test:contract` checks the dashboard Pact. `npm run benchmark` records a bounded read workload without a performance threshold. See [measured results and limits](docs/verification.md). Next work should broaden provider states and write-load contention before claiming broader compatibility or capacity.

All application data and scenarios are synthetic. Source is MIT licensed; installed dependencies retain their own licenses.
