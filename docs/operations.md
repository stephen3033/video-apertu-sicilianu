# Operations and rollout

## State and ownership

Use distinct Terraform state for preview and production. For example, initialize the directory once and select `preview` or `production` workspaces before supplying that environment's `TF_VAR_*` values. For a team, configure an access-controlled remote backend with locking before applying. State contains resource configuration; runtime secrets are injected after provisioning.

```sh
terraform -chdir=infrastructure init
terraform -chdir=infrastructure workspace new preview
op run --env-file .env.preview -- terraform -chdir=infrastructure plan -out=preview.tfplan
op run --env-file .env.preview -- terraform -chdir=infrastructure apply preview.tfplan
terraform -chdir=infrastructure output -json > infrastructure/outputs.preview.json
npm run deploy:config -- infrastructure/outputs.preview.json
```

The official `cloudflare/cloudflare` provider is constrained to `~> 5.0`; its lockfile is versioned. Never remove `prevent_destroy` to fix an ordinary deployment. Terraform creates private R2 buckets with public `r2.dev` access explicitly disabled. Do not attach public R2 custom domains or expiration policies to these buckets. The application custom domain belongs to the Worker, not R2, and must be in a Cloudflare-managed DNS zone.

Wrangler owns queue consumers (batch size 1, concurrency 2, eight retries, dead-letter queue), code, assets, bindings, secrets and the five-minute recovery trigger. The dead-letter queue has its own consumer in the same Worker. Terraform ignores subsequent Worker changes and does not own consumers or schedules.

## Secret delivery and rotation

The six runtime secrets are `AUTH_CODE_SECRET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `IA_ACCESS_KEY`, `IA_SECRET_KEY`, `RESEND_API_KEY`. R2 credentials must be scoped to the corresponding staging bucket. Restrict the deployment token to the intended Cloudflare account. Keep the D1 administrative token separate from the deployment token and never install it as a Worker secret.

1. Update the value in 1Password. Keep reference paths in a private environment file, using `.env.example` as the guide.
2. Run `npm run secrets:sync -- preview .env.preview`, verify preview, then repeat for production.
3. Verify email delivery, multipart upload and a controlled Archive transfer using the replacement.
4. Revoke the old credential at its provider. Authentication-HMAC rotation invalidates outstanding codes; existing opaque sessions remain valid until their absolute expiry or direct invalidation.

The application never contacts 1Password. Synchronization passes an explicit allowlist through standard input; neither Terraform nor generated Wrangler variables contain runtime secret values. Keep token scopes and verified sender configuration separate for preview and production. Do not enable request-body logging or log signed URLs.

## Direct reviewer administration

Run administrative SQL with the separate token, during a controlled operator session. Select an existing verified account by its ID or exact email. New and imported accounts start without reviewer privileges.

```sql
UPDATE users SET is_reviewer = 1 WHERE id = 'ACCOUNT_UUID';
-- Revoke:
UPDATE users SET is_reviewer = 0 WHERE id = 'ACCOUNT_UUID';
-- Invalidate all authenticated and anonymous sessions at cutover if needed:
DELETE FROM sessions;
DELETE FROM login_challenges;
```

Use `op run --env-file .env.admin` to resolve `CLOUDFLARE_DATABASE_ADMIN_TOKEN`, and supply it as `CLOUDFLARE_API_TOKEN` only to the administrative Wrangler command, or use `scripts/admin-db.mjs` for parameterized REST queries. Do not pass token values in command-line arguments. There is no application route that grants reviewer privileges. Revocation applies on the next review request; a navbar already open in a browser updates when the page is reloaded.

## Preview acceptance gate

Local checks establish SQL transitions and streaming behavior; they do not replace these live checks. Keep preview traffic restricted to testers until they pass.

- Apply migrations with `VAS_ADMIN_REFS=.env.admin.preview npm run db:migrate:remote -- preview`; synchronize secrets and use a verified Resend sender. Deploy the generated config with `VAS_SECRET_REFS=.env.preview npm run deploy:preview`.
- Request a real localized code, verify, sign out and confirm that the old session fails. Attempt each review route as an ordinary account, then grant and revoke one reviewer through direct SQL.
- Upload a small controlled recording from the application form. In browser network tools, confirm media PUTs go to the R2 S3 origin and application POSTs contain metadata only. Verify preflight, exposed ETag, exact application origin, and no wildcard/local origin in production CORS.
- Confirm each URL's `X-Amz-SignedHeaders` includes `content-length`; PUT a body of a different length and require storage rejection. Test URL expiry and renewal. Test invalid part numbers, changed part content before completion, and repeat PUTs after multipart completion (must fail).
- Upload a real controlled recording larger than 100 MiB, and one exactly 1,073,741,824 bytes. Confirm 16 MiB browser parts, two concurrent requests, 64 MiB Archive parts and durable per-part checkpoints. Stop and resume transfer processing between parts.
- Accept a recording intended for public release. Confirm IAS3 collection/metadata, Unicode title and notes, no contributor email or reviewer identity, ETag validation and staging deletion after the upstream receipt is stored. Confirm ambiguous completion can be verified with HEAD before any deletion. Live IAS3 compatibility, multipart inventory and redirect hosts remain required checks; an unsupported response fails closed and retains staging.
- Force an upstream throttle or network interruption and verify retries. Force deletion failure after Archive acceptance, then recover it without another upload. Confirm dead-letter state appears in Review and Retry preserves completed parts and the stable Archive item.
- Reject a recording and verify deletion and capacity release. Fill the remaining budget with concurrent reservations: excess requests must return localized HTTP 507 with no upload URL. Existing reservations must still finish, and pending recordings must remain intact.

Do not label the migration production-ready until all live gates pass. These checks can create public Archive items; use approved recordings and an appropriate test account/prefix.

## Production cutover

1. Pass local checks and the live preview gate above.
2. Stop writes to the Python application. Re-inventory immediately: run the exporter to a **fresh** directory. Preserve the resulting SQLite backup and original media. The exporter verifies ownership, file lengths and SHA-256 hashes.
3. Provision production infrastructure with its own state, origin and secrets. Its initial Worker responds with maintenance status 503.
4. Apply migrations, then run the importer under `op run` with a private file containing the D1 administration and production R2 references. The importer reserves each source file before copying it, verifies parts and completed object metadata, then binds original submission IDs/ownership. It does not import login challenges or sessions. Reruns verify matching records and refuse conflicting IDs. Stop on any missing media or capacity error.
5. Compare every imported account and submission against the frozen manifest; the importer does this per row. Verify `PRAGMA foreign_key_check`, migration bookkeeping, and that the unreviewed media has valid R2 references. Account-only local verification is available via `scripts/local-import.mjs`.
6. Synchronize runtime secrets, grant initial reviewers using direct SQL, and deploy the generated production Worker, assets, consumers and scheduled recovery.
7. Verify sign-in, history, direct upload, review, transfer, deletion and accounting before opening traffic. All contributors sign in again at cutover. Retain the source snapshot and manifest securely; they contain account information.

## Queue and cleanup recovery

The outbox records every transfer stage. Dispatch occurs after a review decision and on scheduled recovery. If queue publication succeeds but the D1 acknowledgement fails, dispatch repeats safely. A stage lease lasts 15 minutes; its network deadline is ten minutes. Retry delay grows exponentially to one hour. Durable attempts also prevent scheduled redispatch from indefinitely resetting the retry budget.

Expired leases can resume. Every message includes job ID, generation and stage number. Old messages and dead letters cannot overwrite a later retry generation. The consumer persists final failure, retaining media and its capacity reservation. Reviewer Retry advances the generation, resumes the failed stage, and preserves Archive multipart IDs and completed parts. A rejected recording with failed cleanup can also be retried.

Useful direct queries:

```sql
SELECT state, COUNT(*) FROM transfer_jobs GROUP BY state;
SELECT id, state, attempts, total_attempts, lease_until, next_attempt_at, last_error
FROM transfer_jobs WHERE state <> 'done' ORDER BY created_at;
SELECT COUNT(*) FROM outbox WHERE sent_at IS NULL;
SELECT lifecycle, COUNT(*) FROM submissions GROUP BY lifecycle;
SELECT MIN(created_at) FROM submissions WHERE review_decision = 'pending';
SELECT MIN(created_at) FROM transfer_jobs WHERE state NOT IN ('done', 'failed');
SELECT COUNT(*) FROM submissions WHERE lifecycle = 'cleanup_pending';
```

Recovery redispatches stalled current outbox entries after twenty minutes. It aborts expired incomplete R2 uploads and retries unfinished deletion. Pending review, accepted transfers and failed transfers are never expired by a bucket lifecycle. Outbox and completed job records are retained as operational history; archive them through a deliberate administration procedure if volume warrants it.

## Storage reconciliation

```sql
SELECT COALESCE(SUM(byte_size), 0) AS reserved_and_stored_bytes
FROM uploads WHERE status <> 'released';
SELECT * FROM storage_control;
SELECT phase, COUNT(*), SUM(byte_size) FROM uploads GROUP BY phase;
```

The scheduled inventory checks known object sizes and pinned ETags, unknown objects, missing retained objects and remote multipart reservations. A discrepancy disables new reservations. Database failures also deny authorization. Never free reservations by editing byte counts or marking files released before confirmed storage deletion.

To reconcile: keep `reservations_enabled=0`; list all R2 objects and multipart uploads via an administrative S3 client; match immutable keys to `uploads`; validate object sizes, pinned ETags and upload IDs; inspect active leases and lifecycle states; recover known unfinished uploads or deletion jobs through the application workflow. Unknown media must be identified and explicitly retained/reserved or removed only after operator review. A crash during multipart creation can leave a reservation without a stored multipart ID; expiry cleanup lists/aborts that exact immutable key before releasing it. Re-run the inventory and verify totals are at most 10,000,000,000 before explicitly restoring authorization:

```sql
UPDATE storage_control SET reservations_enabled = 1, discrepancy = NULL WHERE id = 1;
```

Structured application logs include job/upload IDs, transition stages, retry counts, byte totals and fixed error categories. They exclude credentials, login codes outside local console delivery, cookies, signed URLs and authorization flags. Review shows utilization, oldest pending/active entries, cleanup backlog and failed transfer status. Configure alerts around these metrics and sustained queue failures.

## Rollback

Keep schema migrations additive and retain both the source database and export snapshot. Roll back the Worker release with Wrangler's deployment rollback while keeping D1/R2/queue state. Choose a Worker version that understands the current schema and lifecycle states; do not roll back to a maintenance scaffold while expecting queue consumption to continue. Pause acceptance or new authorizations through the documented control record when diagnosing storage issues.

Once Cloudflare accepts production writes, do not route back to the old SQLite app without reconciling those writes, review decisions and media. Never restore an old D1 snapshot independently of R2 and Queue state. Published Archive material cannot be withdrawn by this application; handle withdrawal through a separate Archive administration process.
