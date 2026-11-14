# Consistent pages and a complete migration history

## Reservation reads

A list response combines a count with a page query. Under PostgreSQL's default READ COMMITTED isolation, a writer can commit between those statements: the audit reproduced a response with total zero and one returned item.

The list operation now requests a REPEATABLE READ transaction, so its count and rows share one snapshot. Reservation writes retain their existing isolation and row locks. This fixes consistency within one response; it does not freeze results across separate client requests or introduce cursor pagination. The embedded PGlite adapter already serializes transactions within its process.

`tests/database-integrity.test.ts` pauses after the actual count query, commits a reservation through a second connection, then resumes the page query. The first response stays empty with total zero; a subsequent request sees total one and its item. The test also checks the out-of-range response.

## Migration integrity

Migration filenames must use a unique, nonzero three-digit version and a lowercase descriptive name. Applied entries must be an exact prefix of the sorted on-disk plan, including checksums. Missing applied files, renamed versions, modified content and backfilled versions are rejected before applying new SQL.

PostgreSQL serializes migration startup with a transaction-scoped advisory lock. Validation and all pending migrations share that transaction. Concurrent runners therefore cannot each apply the same migration, and a later SQL failure rolls back earlier pending SQL and ledger entries. A PGlite regression separately checks insertion of an earlier version into an existing history.

This deliberately supports transactional migrations. Operations such as concurrent index creation need a separate, explicitly designed deployment process. Keeping old migration files is part of the repository contract; removing them requires a deliberate baseline migration strategy rather than deleting history.
