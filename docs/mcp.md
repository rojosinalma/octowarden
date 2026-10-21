# MCP

Octowarden is an MCP server over Streamable HTTP at `/mcp`. It needs the same
`Authorization: Bearer <API_TOKEN>` as the JSON API (`503` while unset, `401` when wrong). A client
starts a session with `initialize`; the answer carries `mcp-session-id`, which every later request sends.
Sessions live in memory: at most `mcp_max_sessions` (default 64; the least recently used goes first),
closed after `mcp_session_idle_min` minutes idle (default 30). A client that gets `404` for its session
sends `initialize` again.

Example client entry:

```json
{ "type": "http", "url": "https://octowarden.example.com/mcp", "headers": { "Authorization": "Bearer <API_TOKEN>" } }
```

Tools answer one JSON text item. A refused call sets `isError` and gives `{ok: false, message, code}`,
with the same codes as the [JSON API](api.md) (`confirm_required`, `invalid`, `not_found`, …). Every write
is recorded in the audit trail with source and actor `mcp`. Tool names are a stable contract.

Tools that can delete or overwrite something are marked `destructiveHint`; read-only tools are marked
`readOnlyHint`.

| Tool | Arguments | Does |
|---|---|---|
| `health` | | DB state, version, GitHub auth (mode, source, login or App slug), `github_access` (required versus granted permissions, `missing`, fix links), rate limits, scheduler, bulk runs in flight |
| `list_sections` | | Sections with title, description, JSON Schema of the config and merge key |
| `list_templates` | | Stored and built-in templates |
| `get_template` | `name` | One template with `doc` and `used_by` |
| `upsert_template` | `doc` or `yaml` | Creates or replaces a template (built-in names are read-only) |
| `delete_template` | `name`, `confirm` | Deletes a stored template; `confirm` must be the name |
| `list_sets` | | Stored and built-in sets |
| `get_set` | `name` | One set with `doc` and the repos it is assigned to |
| `upsert_set` | `doc` or `yaml` | Creates or replaces a set; every template must exist |
| `delete_set` | `name`, `confirm` | Deletes a stored set; `confirm` must be the name |
| `list_repos` | `refresh?`, `owner?` | Known repos with assigned sets and drift state |
| `get_repo` | `repo` | One repo with its last 20 events |
| `assign_sets` | `repo`, `sets: [{set, values?}]` | Replaces the repo's assigned sets |
| `repo_lookups` | `repo` | Branches, status check names, team slugs, environments |
| `plan` | `repo`, `sets?`, `templates?`, `doc?`, `values?` | What apply would change; reads GitHub only |
| `apply` | `plan_id` or `repo` + target, `confirm?` | Writes to GitHub; destructive changes need `confirm` = repo full name |
| `bulk` | `repos`, `mode`, `sets?`, `templates?`, `values?` | Background plan/apply/audit over many repos; answers `run_id`. Apply skips destructive changes |
| `audit` | `repos?` | Background drift audit (default: every repo with sets); answers `run_id` |
| `get_run` | `id` | One run with status and summary (bulk: totals and per-repo results) |
| `list_runs` | `limit?`, `kind?` | Recent runs |
| `list_events` | `repo?`, `section?`, `source?`, `actor?`, `outcome?`, `run_id?`, `since?`, `limit?` | Audit trail, newest first |
| `export_yaml` | `templates?`, `sets?`, `manifest?` | YAML text of templates and sets, without secrets |
| `import_yaml` | `yaml` | Imports Template, Set and Manifest documents; answers counts |
| `get_settings` | | Every setting; secrets show as `set` or `""` |
| `set_setting` | `key`, `value` | Changes one setting |
| `create_repo` | `name`, `private`, `owner?`, `description?`, `sets?` | Creates a repo on GitHub and assigns sets (does not apply them) |
| `delete_repo` | `repo`, `confirm` | Deletes a repo on GitHub; `confirm` must be the full name. Cannot be undone |

A typical flow: `list_sections` and `list_templates`, `upsert_template`, `plan` on one repo, read the
changes, then `apply` with the `plan_id` (and `confirm` when the plan reports destructive changes).
