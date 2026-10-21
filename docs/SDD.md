# Octowarden — software design

## Purpose

Octowarden keeps GitHub repository configuration as reusable, composable templates and applies them
to any repository, one at a time or in bulk, with a plan before every change, drift audits and an
audit trail. It serves people through a web UI, scripts and agents through a JSON API and MCP, and
the terminal through a command line tool that also works without a server.

## Architecture

One Bun process (Elysia) serves everything:

```
UI (server-rendered JSX + tailor)   JSON API /api   MCP /mcp   /api/octoforge   /health /metrics
                 \                       |            |              |
                  +---------------- services (src/services) --------+
                                         |
                       engine (resolve → merge → values → plan → apply → audit)
                                         |
                 sections registry ── GitHub client (REST + GraphQL, bounded, logged)
                                         |
                 auth providers (pat, gh, app)          Kysely: SQLite | Postgres schema
```

The command line tool (`src/cli`) uses the same engine in-process with templates from YAML files
(standalone), or the JSON API of a server (`--server`).

## Data model

| Table | Holds |
|---|---|
| `settings` | every tunable and the credentials set from the UI |
| `templates`, `sets` | the documents (sections and template lists as JSON text) |
| `repo_sets` | which sets a repository has, in order, with per-repository values |
| `repos` | cached repository metadata, last audit time, drift state and summary |
| `runs` | plan, apply, sync, audit and bulk runs: source, actor, status, totals |
| `events` | the audit trail: when, actor, source, repository, section, action, outcome, redacted diff |

Ids are UUIDv7 text, timestamps ISO text, JSON as text, so the same schema and migrations run on
both engines.

## Flows

1. **Plan**: resolve the set(s) to templates, merge them in order, substitute values, then each
   section reads the repository's current state and diffs it. Changes GitHub cannot make on this
   repository are moved to `skipped` with the reason.
2. **Apply**: refuses destructive changes without the typed confirmation, applies section by
   section, records one event per change, notifies on failure.
3. **Audit**: a plan that is never applied; any pending change is drift.
4. **Bulk**: plans, applies or audits many repositories with bounded concurrency; progress over
   server-sent events; destructive changes are never applied.
5. **Octoforge**: credential delivery, status and database adoption per [octoforge.md](octoforge.md).

## Configuration surface

Bootstrap variables and secrets in `.env`; every tunable in the `settings` table with its default in
`src/lib/settings.ts`. See [configuration.md](configuration.md).

## Design decisions

Append-only. One line per decision: entry, option, reason, date.

| Entry | Option | Reason | Date |
|---|---|---|---|
| Language | TypeScript on Bun | one language for server, UI and CLI; the same stack as the other Octoforge members | 2026-10-21 |
| Framework | Elysia, server-rendered JSX (`@kitajs/html`), no build step | small surface, fast pages, no SPA to build | 2026-10-21 |
| Interfaces | web UI + JSON API `{ok, message, …}` + MCP + CLI over one services layer | people, scripts and agents get the same operations | 2026-10-21 |
| Database | SQLite default, PostgreSQL in a named schema | standalone needs nothing; a shared Postgres can host one schema per tool | 2026-10-21 |
| Migrations | Kysely, one TypeScript migration set for both engines, additive only, run on boot | two engines without two migration sets | 2026-10-21 |
| Configuration | `settings` table seeded with defaults; `.env` for bootstrap and secrets | everything adjustable at runtime from the UI | 2026-10-21 |
| Background work | one in-process scheduler (audit + purge), bounded GitHub concurrency | no external scheduler needed to run it | 2026-10-21 |
| Extension points | registries: sections, auth providers, notifiers, MCP tools | a new kind is one file and one line | 2026-10-21 |
| Files into repositories | GraphQL `createCommitOnBranch` | no clone needed; commits are signed by GitHub and shown as Verified | 2026-10-21 |
| Unsupported settings | skip with GitHub's reason, never fail the run | plan and visibility limits differ per repository | 2026-10-21 |
| Destructive changes | typed confirmation of the full name; never in bulk | deletes cannot be undone from a template | 2026-10-21 |
| Credentials in the database | stored as plain text, redacted everywhere they could leave | simplicity; the database file is protected like the token | 2026-10-21 |
| Authentication | no UI login (reverse proxy); bearer token for API and MCP | one operator per instance behind an authenticating proxy | 2026-10-21 |
| Command line tool | Bun script, released as one bundled file; no compiled binary | one file to put on the PATH, same code as the server | 2026-10-21 |
| Observability | stdout logs with subsystem prefixes, `/health` with a DB ping, Prometheus `/metrics` | standard scraping and probes | 2026-10-21 |
| Delivery | semver via release-please; image on ghcr.io; AGPL-3.0 | hosted forks stay open | 2026-10-21 |

## Current scope

Nine sections, three auth providers, one notifier (Discord), the Octoforge member contract
version 1. The registries are where it grows: more sections (environments, deploy keys,
collaborators, Actions permissions), more notifiers, organization-wide settings.

## Operations

See [operations.md](operations.md).
