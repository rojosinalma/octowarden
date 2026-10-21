# Octoforge member contract

Octowarden implements version 1 of the [Octoforge](https://github.com/rojosinalma/octoforge) member
contract. Everything here is optional: without `OCTOFORGE_TOKEN` every `/api/octoforge/*` route answers
`404` and octowarden works on its own as before.

## Manifest

`octoforge.json` at the repository root describes octowarden to Octoforge: the GitHub App permissions
and token scopes it needs, the database engines it supports and the names of its environment
variables. `GET /api/octoforge/manifest` serves the same document, not wrapped, with no bearer.

Why these permissions (the full list with what breaks without each: [github-app.md](github-app.md)):

| Permission | Used for |
|---|---|
| `administration: write` | repo settings, security toggles, rulesets, branch protection, topics, create and delete repos |
| `contents: write` | template files and git hooks (signed commits) |
| `pull_requests: write` | labels; templates that propose files as a pull request |
| `repository_hooks: write` | webhooks |
| `workflows: write` | template files under `.github/workflows/` |
| `checks: read`, `statuses: read` | status check names for required-check pickers |
| `actions: read` | environment names for pickers (GitHub serves the environment list under Actions) |
| `members: read` | team slugs in organizations |
| `metadata: read` | every repo read |

A classic token needs `repo`, `admin:repo_hook`, `delete_repo`, `workflow` and `read:org`. Octowarden
does not receive GitHub webhooks, so the App asks for no events.

## Routes

Every route except `manifest` needs `Authorization: Bearer <OCTOFORGE_TOKEN>` (constant-time compare,
`401` on mismatch). Bodies are read only after the token check.

| Route | Does |
|---|---|
| `GET /api/octoforge/manifest` | The manifest |
| `PUT /api/octoforge/siblings` | the sibling list `{forge, members, updated_at}`; stored in the `octoforge_siblings` setting and shown as an Octoforge group in the sidebar (links to Octoforge and every other member, this instance marked). The group shows only while Octoforge is set up: `OCTOFORGE_TOKEN` is set and Octoforge re-sent the list within `siblings_stale_min` minutes (default 180); otherwise it is hidden. |
| `DELETE /api/octoforge/siblings` | clears the list; the group disappears |
| `GET /api/octoforge/status` | `{ok, message, contract, version, github: {mode, source, app_id?, login?, missing?, permissions_url?, install_url?}, database: {engine, schema?, source}}` |
| `PUT /api/octoforge/github` | `{mode: "pat", token}` or `{mode: "app", app_id, private_key, webhook_secret?, installation_id?}` |
| `DELETE /api/octoforge/github` | Drops the delivered credential |
| `POST /api/octoforge/database/adopt` | `{url, schema, copy}`: moves to another database |
| `DELETE /api/octoforge/database` | Drops the adopted database; the next start uses `DATABASE_URL` |

### GitHub credentials

`PUT /github` checks the credential against GitHub first: `GET /user` for a token, `GET /app` with the
App's JWT for an App (and the installation when `installation_id` is given). A rejected credential
answers `422` with GitHub's reason. A good one is stored in the settings (`github_token`, or
`github_app_id`, `github_app_private_key`, `github_app_installation_id`, `github_webhook_secret`),
`github_auth_mode` is set to the delivered mode and `github_credential_source` to `octoforge`. It is in
use at once: the answer is `{ok, message, login}` or `{ok, message, app_slug}` with
`restart_required: false`. A delivered credential wins over the environment.

`DELETE /github` clears the delivered values and sets `github_auth_mode` back to `auto`, so octowarden
uses its environment credentials again (`removed: false` when nothing was delivered).

In `status`, `github.missing` lists the permissions octowarden needs and the credential definitely lacks
(`<permission>:<level>`; unknown grants are never listed), `permissions_url` is where the owner edits the App or
token and `install_url` is where an installation accepts new permissions. The values come from the same cached
check as the Settings page.

In `status`, `github.source` is `octoforge` for a delivered credential, `env` for one set on the
instance (environment, Settings page or the gh CLI) and `none` without credentials.

### Database adoption

`POST /database/adopt` with `{url, schema, copy}`:

1. Opens `url` (`sqlite:<path>` or `postgres://…`), creates `schema` on Postgres when it is missing and
   runs octowarden's migrations there.
2. With `copy: true` (default) copies every table in batches inside one transaction on the target, then
   compares row counts per table. A difference rolls the copy back, answers `409 count_mismatch` and
   leaves the current database in use. The target's own rows in octowarden's tables are replaced.
3. Writes `url` and `schema` to `DATA_DIR/octoforge-database.json` (mode `0600`). At start-up this file
   wins over `DATABASE_URL` and `DATABASE_SCHEMA`.
4. Answers `{ok, message, tables: {<table>: <rows>}, restart_required: true}`.

The current database is never changed, so `DELETE /database` and a restart roll back. Rows written
after the adoption stay in the new database only. For SQLite, `schema` is stored but not used.

Credentials and database passwords never appear in an answer or a log line; URLs in logs are masked.
