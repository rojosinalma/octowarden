# Configuration

Octowarden reads a few bootstrap variables from `.env` (the app loads it itself) and keeps every
other setting in its database, editable on the Settings page or through `PUT /api/settings`.

## Environment

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `PORT` | no | `3000` | HTTP port |
| `DATA_DIR` | no | `./data` | SQLite database, backups and the Octoforge adoption file |
| `DATABASE_URL` | no | `sqlite:<DATA_DIR>/octowarden.db` | `sqlite:<path>` or `postgres://user:password@host:5432/db` |
| `DATABASE_SCHEMA` | no | `octowarden` | Postgres schema that holds every table (created when missing) |
| `DATABASE_POOL_MAX` | no | `5` | Postgres connection pool size |
| `API_TOKEN` | for `/api`, `/mcp` | | bearer token for the API, MCP and the command line tool's server mode; while unset those routes answer `503` |
| `GITHUB_TOKEN` | no | | personal access token; a token set in Settings wins |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_INSTALLATION_ID` | no | | GitHub App; the key as PEM with literal `\n`; values set in Settings win |
| `GITHUB_WEBHOOK_SECRET`, `WEBHOOK_SECRET_*` | no | | secrets templates may reference with `secret_ref` |
| `OCTOFORGE_TOKEN` | no | | enables the [Octoforge member API](octoforge.md) |
| `LOG_LEVEL` | no | `info` | `debug`, `info`, `warn`, `error`; the `log_level` setting wins once the database is up |

Compose only: `OCTOWARDEN_BIND` (default `127.0.0.1`), `OCTOWARDEN_PORT` (`3000`),
`OCTOWARDEN_MEM` (`256m`), `OCTOWARDEN_CPUS` (`0.5`).

Command line tool: `OCTOWARDEN_SERVER`, `OCTOWARDEN_TOKEN`, `OCTOWARDEN_LOG_LEVEL` (see [cli.md](cli.md)).

## GitHub credentials

`github_auth_mode` picks the source: `auto` tries a GitHub App, then a token, then the GitHub CLI
login; `app`, `pat` and `gh` force one.

| Mode | Use when |
|---|---|
| `pat` | one person manages their own repositories; also the only way to create repositories on a personal account |
| `app` | organizations, or when you do not want a personal token in the app; finds the installation for each owner when no installation id is set |
| `gh` | the command line tool on a machine where `gh auth login` was run |

Permissions:

- Classic token: `repo`, `admin:repo_hook`, `delete_repo`, `workflow`, `read:org`.
- Fine-grained token or App: Administration, Contents, Pull requests, Issues, Webhooks and Workflows
  read and write; Checks, Commit statuses, Environments, Members and Metadata read.

Rulesets and branch protection on private repositories need GitHub Pro, Team or Enterprise; on
GitHub Free those sections are skipped for private repositories with GitHub's reason.

## Settings

| Key | Default | Meaning |
|---|---|---|
| `github_auth_mode` | `auto` | see above |
| `github_token`, `github_app_id`, `github_app_private_key`, `github_app_installation_id`, `github_webhook_secret` | | credentials set from the UI; stored in the database as plain text, never shown again |
| `default_owner` | | owner preselected when creating repositories and listing them |
| `audit_interval_min` | `360` | minutes between scheduled audits of every repository with a set |
| `audit_jitter_s` | `120` | random delay added to each audit |
| `audit_min_rate_remaining` | `500` | skip a scheduled audit while GitHub's rate limit left is below this |
| `audit_retention_days` | `30` | audit events older than this are purged |
| `github_concurrency` | `4` | parallel GitHub requests |
| `bulk_max_repos` | `500` | repositories per bulk run |
| `repos_refresh_max` | `1000` | repositories fetched per refresh |
| `plan_ttl_min` | `30` | unapplied plans expire |
| `notify_discord_webhook` | | Discord webhook for notifications |
| `notify_on_drift`, `notify_on_apply_fail` | `true` | which events notify |
| `ui_actor_header` | `remote-user` | request header your reverse proxy sets with the user name, recorded as the actor |
| `ui_skin`, `ui_palette`, `ui_mode` | `luz`, `ayu`, `dark` | appearance |
| `sse_max_clients`, `sse_idle_s` | `20`, `300` | live update streams |
| `mcp_max_sessions`, `mcp_session_idle_min` | `64`, `30` | MCP sessions |
| `backup_dir`, `backup_keep` | `<DATA_DIR>/backups`, `14` | `bin/backup` target and how many snapshots it keeps |
| `log_level` | `info` | |
