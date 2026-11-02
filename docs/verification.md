# First milestone verification

Verified locally on 2 November 2026 with Node.js 24.4.0 on macOS.

- Locked dependency installation: passed; npm reported zero known vulnerabilities.
- Strict TypeScript check, floating-promise lint and formatting check: passed.
- Node unit suite: 6 passed, zero failures/skips.
- Playwright HTTP/API suite: 17 passed, zero failures/skips, retries disabled.
- Actual CLI entry point: started against a temporary filesystem database; health and OpenAPI endpoints responded; SIGTERM exited with code 0.
- A source-only copy in a separate directory with a space in its path passed npm ci --ignore-scripts and the complete npm run verify command: 6 unit tests and 17 API tests.

The database-reopening test covers persistence through an orderly close/reopen. It does not prove power-loss durability or multi-process recovery. The HTTP duplicate-request test exercises one running service and one embedded database instance. The ownership negative control deliberately removes the tenant predicate within a test-owned service and verifies that the normal denial assertion rejects the resulting leak.

GitHub-hosted CI has not run for this milestone. The workflow is provided, but Linux execution is not claimed until an actual run completes. No model calls, external services, paid accounts or production data were involved.
