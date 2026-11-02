# Contributing

Use Node 24. Run `npm ci --ignore-scripts` and `npm run verify` before proposing changes. Keep fixtures synthetic. Do not commit databases, reports, tokens or employer material.

Keep tenant predicates in SQL, enforce permission checks on the server, and test resulting state after rejected writes. A new API field needs an explicit schema decision and a compatibility test. Do not weaken ownership or negative-control assertions to make a change pass.

For a storage change, explain what is atomic and which processes share the database. For a new metric, provide the measurement command, environment and raw result. Prefer one complete behavior over a large unfinished framework.
