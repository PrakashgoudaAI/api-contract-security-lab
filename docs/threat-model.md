# Threat model for the local lab

Assets: tenant-owned reservation records, inventory counts and idempotency intent. Trust boundary: a session's tenant/role is assigned by the local demo issuer, then enforced by the service and database queries. Public credentials intentionally make the issuer unsuitable for production.

| Scenario | Control and evidence | Remaining limit |
| --- | --- | --- |
| Tenant B requests tenant A's ID | Tenant predicate and identical unknown/foreign 404; negative-control test removes predicate | Not a production identity assessment |
| Viewer submits a reservation | Server role check before mutation; four-role matrix | Public issuer allows selecting roles for demonstrations |
| Caller supplies tenantId | Strict request schema rejects extra fields; tenant comes from session | Real token audience/issuer checks not implemented |
| Duplicate or uncertain request | Tenant-scoped key, canonical fingerprint and SQL transaction | No separate-process race evidence |
| Invalid quantity or stock exhaustion | JSON schema plus DB constraints; rollback tests | No real product catalogue |
| Unbounded input | 8 KiB cap, 5-second request/socket timeout, bounded pagination | No rate limiter or load-based defense |
| Internal database exception | Generic 500 and fixed diagnostic text; fault injection | No production observability pipeline |
| Report retains credentials | No traces or raw HTTP logging; synthetic data only | Review future reporter changes before use with sensitive systems |

No employer data, URLs, workflows or application models are used. No authentication tokens, database directories or generated reports belong in Git. Dependency audit results cover known package advisories at the time checked, not a security certification.
