# Video Apertu Sicilianu

A TypeScript/Hono application for contributing Sicilian audio and video, running on Cloudflare Workers with D1, private R2 staging, and Queues for Internet Archive publication. The existing HTMX layout, asset URLs and English, Sicilian and Italian content are preserved.

## Local development

Use Node.js 22 or newer. Python is needed only for exporting the legacy SQLite database. Terraform provisions hosted infrastructure.

```sh
npm ci
cp .dev.vars.example .dev.vars
npm run db:migrate
npm run dev
```

In a second terminal:

```sh
npm run dev:upload-proxy
```

Open http://localhost:8787. Development login codes appear in the Worker console. The second origin, http://localhost:8788, emulates direct R2 multipart uploads locally. The deployed Worker rejects this adapter. Deployment references in `.env` are never loaded as local Worker secrets; development uses `.dev.vars` only.

## Verification

```sh
npm run typecheck
npm test
npm run config:test
npm run test:migration
npm run test:browser
npm run deploy:dry-run
terraform -chdir=infrastructure fmt -check
terraform -chdir=infrastructure validate
```

Browser tests use installed Chrome and isolated D1/R2 storage. They deliver email to a local test capture and exercise a separate upload origin. The workerd suite uses real local bindings, mocked upstream responses, and streamed recordings above 100 MiB and at the full 1 GiB limit. A small `sharp` override fixes the test runtime's transitive dependency advisory without changing its Workers API.

A local test cannot establish production R2 signature enforcement, CORS, or IAS3 compatibility. Complete the [preview and cutover checklist](docs/operations.md) before opening traffic. No hosted resources have been provisioned by these instructions.

## Configuration and deployment

[.env.example](.env.example) describes every deployment input and 1Password reference with intentional placeholders. [infrastructure/terraform.tfvars.example](infrastructure/terraform.tfvars.example) supplies the corresponding Terraform shape. Preview and production use separate state, resource names, origins and credentials. Generated `wrangler.preview.json` and `wrangler.production.json` reject missing identifiers, placeholders, secrets and local adapters.

Terraform owns D1 databases, private R2 buckets and their CORS, queues, and initial Worker creation. Wrangler owns subsequent Worker code, assets, bindings, secrets, consumers, schedules and application custom domains. A Terraform-created Worker serves maintenance responses and ignores later deployment changes. D1 databases, R2 buckets and Workers have destruction protection.

```sh
# Select separate preview state; keep credentials outside Terraform variables.
op run --env-file .env.preview -- terraform -chdir=infrastructure plan
# After reviewing and applying that plan:
terraform -chdir=infrastructure output -json > infrastructure/outputs.preview.json
npm run deploy:config -- infrastructure/outputs.preview.json
npm run db:migrate:remote -- preview
npm run secrets:sync -- preview .env.preview
VAS_SECRET_REFS=.env.preview npm run deploy:preview -- --dry-run
VAS_SECRET_REFS=.env.preview npm run deploy:preview
```

Set `VAS_ADMIN_REFS` to the private file containing the separate database-administration reference. That token is never supplied to the application or its Worker secrets. Secret synchronization resolves `op://` references through `op run`, then passes only the six runtime secrets through Wrangler's standard input.

## Migration

The legacy Python application and templates remain available as migration references. The source database is never modified by the exporter.

```sh
python3 scripts/export-legacy.py data/app.db data-export/cutover --media-root data/uploads
node scripts/local-import.mjs data-export/cutover/manifest.json
# Hosted import, during maintenance, with resolved administration and R2 credentials:
op run --env-file .env.migration -- node scripts/import-legacy.mjs production data-export/cutover/manifest.json
```

Each export writes a consistent SQLite backup and manifest to a fresh directory with restricted permissions. Import preserves account/submission IDs, ownership and original timestamps; it imports no sessions, login codes or reviewer grants. Existing submissions use full-size capacity reservations and multipart uploads before their storage references are accepted. Reruns verify existing records and refuse conflicting data. The local import checker is for the current account-only source; media import is covered with a synthetic fixture and the hosted importer.

## Review and storage

Reviewer access is controlled only by `users.is_reviewer`, edited through direct database administration. There is no account-facing role field or role-management endpoint. Review endpoints read the current database value. The persistent Review tab shows metadata, authenticated range downloads, review controls, utilization and transfer failures.

The staging budget is **10,000,000,000 bytes**, and the per-recording limit is **1 GiB (1,073,741,824 bytes)**. A conditional insert reserves the complete file size before upload authorization. Pending review and failed transfers retain their reservations indefinitely. Unfinished uploads expire after 24 hours and are aborted before capacity is released.

Acceptance records a decision, transfer job and outbox entry atomically. Queue delivery can repeat; leases, generations and checkpoints prevent duplicate state transitions. Small files stream in one IAS3 PUT; files above 100 MiB use 64 MiB multipart transfer steps. Archive acceptance is persisted before staging deletion. Failed deletion retries cleanup without resending media. “Published” means IAS3 accepted the file and R2 cleanup completed; Archive processing may continue.

See the [verification record](docs/verification.md) for completed checks and remaining live gates.

See [operations and rollback](docs/operations.md) for reviewer SQL, rotations, queue recovery, storage reconciliation, deployment gates and rollback constraints.
