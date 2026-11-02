# Start with an embedded PostgreSQL database

The first milestone needs durable data, constraints and rollback that a reviewer can reproduce without a cloud account. Docker is not available in the initial development environment. A mocked repository would avoid the hard behavior the project is meant to test.

PGlite runs PostgreSQL in-process and supports the parameterized SQL and transaction APIs required here. Filesystem storage is the default interactive mode; tests use unique temporary directories or an in-memory database. Existing inventory is not overwritten on startup.

The trade-off is explicit: one database instance belongs to one process. Concurrent requests test transaction behavior inside that boundary. They do not test network partitions, connection pooling or uniqueness races between independent PostgreSQL clients. A separate PostgreSQL adapter and two-process tests are required before making those claims.

SQLite was considered but would introduce a different SQL dialect for the later PostgreSQL milestone. Starting with a full container stack would prevent a clean first run on this host. We chose a working embedded slice and preserved the later server-database milestone instead of shipping an unexecuted Compose file.

Official references: [PGlite setup](https://pglite.dev/docs/) and [transaction API](https://pglite.dev/docs/api).
