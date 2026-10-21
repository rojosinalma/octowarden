# JSON API

Every route under `/api` needs `Authorization: Bearer <API_TOKEN>`. While `API_TOKEN` is unset they all
answer `503`; a missing or wrong token gets `401`. Answers are JSON: `{ok: true, message, ...data}` on
success and `{ok: false, message, code, ...data}` on failure.

| Status | Code | When |
|---|---|---|
| 401 | `unauthorized` | missing or wrong bearer token |
| 404 | `not_found` | unknown template, set, repo, run or plan |
| 409 | `confirm_required` | a destructive action without the typed confirmation |
| 409 | `conflict` | the action clashes with current state (built-in name, template still used by a set, …) |
| 422 | `invalid` | the body or query failed validation; `issues` lists the fields |
| 503 | `unavailable` | `API_TOKEN` or the GitHub credentials are not configured |

Every write is recorded in the audit trail with source `api` and actor `api`.

## Sections

`GET /api/sections` → `{ok, sections: [{name, title, description, jsonSchema, mergeKey?}]}`.
`jsonSchema` describes the config a template may give for the section.

## Templates and sets

| Route | Body | Answer |
|---|---|---|
| `GET /api/templates` | | `{ok, templates}`: stored templates and the built-in starter templates (`builtin: true`) |
| `GET /api/templates/:name` | | `{ok, template}` with `doc` (the document) and `used_by` (set names) |
| `PUT /api/templates/:name` | Template document | `{ok, message, template}`, `201` when created |
| `DELETE /api/templates/:name` | `{confirm: "<name>"}` | `{ok, message, template}` |
| `GET /api/sets` | | `{ok, sets}` |
| `GET /api/sets/:name` | | `{ok, set}` with `doc` and `repos` (where it is assigned) |
| `PUT /api/sets/:name` | Set document | `{ok, message, set}`, `201` when created |
| `DELETE /api/sets/:name` | `{confirm: "<name>"}` | `{ok, message, set}` |

A template document:

```json
{
  "apiVersion": "octowarden/v1",
  "kind": "Template",
  "metadata": { "name": "squash", "description": "Squash merges only" },
  "spec": {
    "requires": { "visibility": "any" },
    "sections": { "settings": { "allow_merge_commit": false, "allow_squash_merge": true } }
  }
}
```

A set document lists templates in apply order (later ones win) and default values:

```json
{
  "apiVersion": "octowarden/v1",
  "kind": "Set",
  "metadata": { "name": "house" },
  "spec": { "templates": ["base", "security", "protect-main"], "values": { "required_checks": "check" } }
}
```

`metadata.name` must match the name in the URL. Built-in names are read-only: saving or deleting them
answers `409`. A template that a set still lists, or a set that is still assigned to repos, cannot be deleted.

## Repos

| Route | Body / query | Answer |
|---|---|---|
| `GET /api/repos` | `?refresh=1` reads the list from GitHub first; `?owner=` filters | `{ok, repos}` |
| `POST /api/repos` | `{owner?, name, private, description?, sets?}` | `{ok, repo}`, `201` |
| `GET /api/repos/:owner/:name` | | `{ok, repo}` with the last 20 `events` |
| `DELETE /api/repos/:owner/:name` | `{confirm: "<owner/name>"}` | `{ok, repo}` (the repo as it was) |
| `PUT /api/repos/:owner/:name/sets` | `{sets: [{set, values?}]}` | `{ok, repo}` |
| `GET /api/repos/:owner/:name/lookups` | | `{ok, branches, checks, teams, environments}` |

A repo: `{full_name, owner, name, private, visibility, fork, archived, default_branch, description,
sets: [{set, values}], drift_state, drift_summary, last_audit_at}`. `drift_state` is `clean`, `drift`,
`error` or `unknown` (never audited).

`POST /api/repos` creates the repo under an organization when `owner` is one, otherwise under the
token's user; `owner` defaults to the `default_owner` setting. `sets` are assigned, not applied.
`DELETE` deletes the repo on GitHub. It cannot be undone.

`PUT …/sets` replaces the assignment; the order is the apply order, and an empty list removes every set.
`lookups` gives names for pickers: branch names, status check names seen on the default branch's
latest commit, team slugs (organizations only) and environment names.

## Plan and apply

| Route | Body | Answer |
|---|---|---|
| `POST /api/plan` | `{repo, sets?, templates?, doc?, values?}` | `{ok, plan}` |
| `POST /api/apply` | `{plan_id, confirm?}` | `{ok, report}` |
| `POST /api/apply` | `{repo, sets?, templates?, doc?, values?, confirm?}` | `{ok, plan, report}` |
| `POST /api/bulk` | `{repos, sets?, templates?, values?, mode: "plan" \| "apply" \| "audit"}` | `{ok, run_id}`, `202` |
| `POST /api/audit` | `{repos?}` | `{ok, run_id}`, `202` |

Without `sets`, `templates` or `doc`, a repo uses its assigned sets. Values win in this order (low to
high): set values, per-repo values, `values` in the call.

`plan` reads GitHub only. The answer holds `id`, `changes` (`{section, op, target, before, after,
destructive}`), `skipped` (sections the repo's plan or visibility does not allow, with the reason) and
`destructive` (a count). A plan waits in memory for `plan_ttl_min` minutes (default 30, at most 200 plans);
apply it by `plan_id` to write exactly what you reviewed.

When a plan holds destructive changes, apply answers `409 confirm_required` unless `confirm` is the repo's
full name. The report: `{run_id, repo, status, results: [{change, outcome, message}], skipped, applied, failed}`.

`bulk` and `audit` run in the background and answer at once. Bulk apply never applies destructive
changes: they are skipped with the reason `destructive: apply on the single repo with confirm`. Follow
progress on the stream (topic `run`) or with `GET /api/runs/:id`. `audit` without `repos` checks every
repo that has sets assigned.

## Runs and events

| Route | Query | Answer |
|---|---|---|
| `GET /api/runs` | `?limit=` (max 200), `?kind=plan\|apply\|sync\|audit` | `{ok, runs}` |
| `GET /api/runs/:id` | | `{ok, run}`; bulk runs carry `summary.totals` and `summary.results` |
| `GET /api/events` | `?repo&section&source&actor&outcome&since&run_id&before&limit` | `{ok, events}` |

Events are newest first (default 100, max 500). `since` is an ISO date or time; `before` is an event id
for paging. Diffs in events are redacted. Events and finished runs are deleted after
`audit_retention_days`.

## Export and import

`GET /api/export?templates=a,b&sets=c&manifest=1` answers `text/yaml`: one document per template and
set. Without names it exports every stored template and set; built-ins only when named. `manifest=1`
adds a `Manifest` with the repo assignments. String values under secret-looking keys (token, secret,
password, private key) become `${{ values.<key> }}`, and secret-looking values are left out.

`POST /api/import` takes the YAML as the body (`content-type: text/yaml`) or `{yaml: "…"}` as JSON. It
validates every document before it writes anything, then stores templates, sets and manifest
assignments. A built-in name is accepted only with identical content. Answer: `{ok, message, counts:
{templates, sets, repos}}`.

## Settings

`GET /api/settings` → `{ok, settings}`. `PUT /api/settings` with `{key: "value", …}` changes several
keys at once and answers the same shape. Values are strings: integers as digits, booleans as
`true`/`false`. Every key is checked before any is written. Secrets show as `set` or `""`; sending `set`
back leaves a secret unchanged, `""` clears it.

## Stream

`GET /api/stream` (bearer) and `GET /ui/stream` (no bearer, for the web UI behind your proxy) are
Server-Sent Events: `event: <topic>` and `data: <json>`. `?topics=event,run,drift,settings` picks
topics (default all).

| Topic | Data |
|---|---|
| `event` | `{id, repo, section, outcome, action, run_id}` |
| `run` | `{id, kind, status}` on start and finish; bulk progress `{id, run_id, kind, status: running\|done\|failed, repo, done, total, summary}`; bulk end `{id, run_id, status: finished, totals}` |
| `drift` | `{repo, state}` when a repo's drift state changes |
| `settings` | `{key}` (never the value) |

Open streams are capped by `sse_max_clients` (`503` beyond); a stream closes after `sse_idle_s`
seconds without data, and a `: ping` comment every 25 s keeps proxies from closing it.

## Health and metrics

`GET /health` (no auth) → `200 {ok, db, version, github}` or `503` when the database fails. GitHub state
is informative only.

`GET /metrics` (no auth) serves Prometheus text: `octowarden_repos{drift_state}`,
`octowarden_applies_total{outcome}`, `octowarden_runs_total{kind,status}`,
`octowarden_github_rate_remaining{resource}`, `octowarden_last_audit_timestamp_seconds` and the process
defaults (`octowarden_process_*`, `octowarden_nodejs_*`). Keep `/metrics` off the public path at your proxy.
