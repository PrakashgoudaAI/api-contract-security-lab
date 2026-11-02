# Coordinate reservations in PostgreSQL

The embedded milestone serialized work within one process. That could not establish correctness for two independent HTTP services sharing stock.

The PostgreSQL adapter uses a connection pool and a checked-out connection for each transaction. Reservation creation locks the tenant/SKU inventory row before reading the idempotency key, then decrements stock and inserts the reservation in the same transaction. At READ COMMITTED isolation, a waiter reads the first transaction's committed reservation after acquiring that row lock. This deliberately coarse lock is appropriate for the single-SKU exercise; a production multi-item order needs a consistent lock order and a different contention assessment.

Versioned SQL files have SHA-256 checksums in `schema_migrations`. An advisory transaction lock serializes concurrent startup migrations. A changed applied file fails startup. A new migration is the supported way to evolve an installed schema. This is a small forward migration runner, not an online deployment/rollback framework.

`DATABASE_URL` selects an external PostgreSQL server; leaving it unset keeps PGlite. Both adapters execute the same migrations. Separate processes must use PostgreSQL rather than opening the same PGlite directory.

Tests prove two local Node processes agree on replay, conflicts and stock, and can recover their pools after an orderly database restart. They do not prove partition tolerance, failover, exactly-once delivery across other systems or disaster recovery.
