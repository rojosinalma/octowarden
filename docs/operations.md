# Operations

## Health and metrics

| Route | Auth | Answer |
|---|---|---|
| `GET /health` | none | `200 {ok, db: "ok", version, github: {mode, login?}}`; `503` when the database does not answer. GitHub problems never turn it red. |
| `GET /metrics` | none | Prometheus: `octowarden_repos{drift_state}`, `octowarden_applies_total{outcome}`, `octowarden_runs_total{kind,status}`, `octowarden_github_rate_remaining`, `octowarden_last_audit_timestamp_seconds`, process metrics |

The image has a `HEALTHCHECK` on `/health`.

## Logs

Stdout, one line per event, with a subsystem prefix: `[http]`, `[github]`, `[apply]`, `[audit]`,
`[scheduler]`, `[mcp]`, `[notify]`, `[db]`, `[octoforge]`, `[backup]`. Every GitHub call logs its
route, status and the rate limit left. Secrets are redacted.

## Background work

One scheduler inside the process audits every repository with an assigned set every
`audit_interval_min` minutes (plus jitter), notifies on new drift, and purges audit events older
than `audit_retention_days`. It skips a round when no GitHub credentials are set or the rate limit
is low. Nothing else runs on a timer.

## Backups

`bin/backup` writes a consistent SQLite snapshot (`VACUUM INTO`) to `backup_dir`, checks its
integrity and keeps the newest `backup_keep`. Run it from your scheduler:

```sh
docker exec octowarden /app/bin/backup
```

It exits non-zero with the reason on failure, for example when the backup directory is not
mounted. Restore: stop the container, copy a snapshot to `data/octowarden.db`, start it.
With Postgres, back up the schema with `pg_dump -n octowarden`.

Templates and sets also export to YAML (`octowarden export`, `GET /api/export`), which is a
portable copy of everything except the audit trail and the stored credentials.

## Upgrades

Pull the new image and recreate the container. Migrations run on start and only add tables and
columns, so a rollback to the previous minor version keeps working on the same database.

## Failure modes

| What fails | What happens |
|---|---|
| GitHub unreachable or credentials invalid | plans, applies and audits fail per repository with the reason; `/health` stays green |
| A setting the repository's plan does not allow | that change is skipped with GitHub's reason; the rest applies |
| Database unreachable | `/health` answers `503`; requests fail |
| Backup directory missing | `bin/backup` exits 1 |
