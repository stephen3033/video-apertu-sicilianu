# Verification record

Local implementation verified on 2026-09-21. No preview or production resources were provisioned or deployed. Deployment inputs remain documented placeholders in `.env.example`, as requested.

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm run format:check` | Passed |
| `npm test` | 27 tests passed in workerd with local D1/R2 |
| `npm run test:browser` | Passed in Chrome with isolated storage and a separate upload origin |
| `npm run test:migration` | Passed: account/media identity, ownership, storage references, repeat import, source-change rejection |
| `npm run config:test` | 2 tests passed: invalid configuration rejection and secret allowlist |
| `npm run db:migrate` | Both migrations applied; repeat run reported no migrations to apply |
| Source export and `scripts/local-import.mjs` | One account, zero submissions; repeat import passed; zero reviewers, sessions or challenges imported |
| `npm run deploy:dry-run` | Passed; Worker and static assets bundled with D1/R2/Queue bindings |
| `terraform -chdir=infrastructure fmt -check` | Passed |
| `terraform -chdir=infrastructure validate` | Passed with Homebrew Terraform 1.16.3 and locked Cloudflare provider 5.25.0 |
| Dependency audit during final install | Zero reported vulnerabilities |

Worker coverage includes concurrent code verification and send limiting, expiry/CSRF/logout, multilingual HTML escaping and history scoping, reviewer revocation and competing decisions, capacity under concurrent reservations, duplicate requests, multipart size/signature validation, cancellation and recovery, outbox/lease recovery, duplicate delivery, retry generations/dead letters, trusted redirect enforcement, lost acknowledgements, deletion ordering and inventory failure.

The streaming tests transfer both 105,906,177 bytes (101 MiB + 1 byte) and 1,073,741,824 bytes (1 GiB) in 64 MiB Archive parts. They assert bounded stream chunks and durable part records. Archive HTTP responses are mocked; this verifies application behavior rather than actual IAS3 compatibility.

The browser flow verifies Italian and Sicilian content, fresh authentication redirect, navbar identity across HTMX navigation/history, direct Blob PUT to a second origin, metadata-only application POSTs, authenticated downloads, acceptance, rejection and localized capacity messages. Chromium reports Blob body size as zero through the generic size API; the test uses the network Content-Length and verifies the downloaded bytes.

The source database was opened read-only and backed up to the ignored directory `data-export/implementation-check/`. Its manifest was imported twice into an isolated local D1 database. The original SQLite database remains the source of truth until the documented cutover.

Still required before production: an authenticated Terraform plan, preview provisioning, real Resend delivery, real R2 CORS/signature/length enforcement, live IAS3 multipart/redirect/HEAD compatibility (including large and maximum-size media), a fresh cutover inventory/import, and production smoke checks. Follow [operations.md](operations.md). Local validation is not an authenticated infrastructure plan or a live publication test.
