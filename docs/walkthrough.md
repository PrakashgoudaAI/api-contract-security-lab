# Follow a reservation through failure and recovery

Start with `npm ci` and `npm run verify` on Node 24. The complete command includes unit tests, API behavior, native PostgreSQL coordination and the dashboard consumer contract. The database tests own their temporary server and credentials.

1. Read the reservation API tests alongside `src/store.ts`. Trace a successful reservation through authentication, input validation, idempotency, inventory locking and persisted state.
2. Follow the repeated request and conflicting-intent cases. Reusing a key must recover the same result; changing its intent must fail. Two independent service processes compete for the same stock in `tests/postgres.test.ts`.
3. Inspect the read-snapshot regression in `tests/database-integrity.test.ts`. A controlled second writer commits between count and page queries. The test proves that a single response cannot mix two snapshots.
4. Inspect migration negative controls: removal, version conflicts, checksum drift and an invalid later statement. A rejected startup must leave neither partial schema changes nor an advanced ledger.
5. Follow the actual dashboard client into `tests/consumer-contract.test.ts`. A renamed field breaks the consumer; an unrelated addition is compatible. The generated Pact is verified against the provider.

If a request's response is lost after a write, preserve its idempotency key and intent. Reconciliation needs the persisted result; issuing a new key can create a different operation. This repository demonstrates those boundaries on one host. It does not establish behavior under remote network partitions or ungraceful database crash recovery.

The [verification record](verification.md) separates local runs, hosted runs and the deliberately narrow read benchmark. There is no production capacity claim.
