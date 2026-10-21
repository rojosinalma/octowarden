# Contributing

Thanks for helping. Octowarden is one container and one language, with a few registries where most
changes land: template sections, GitHub auth providers, notifiers and MCP tools. Most changes are a
small, focused diff.

## Running it locally

- [Bun](https://bun.sh) 1.4 or newer
- Docker (optional: the container build and the Postgres tests)
- A GitHub token in `.env` (`cp .env.example .env`) if you want real repositories in the UI

```sh
bun install
bun run dev        # server on :3000 with bun --watch
bin/octowarden --help
```

## Tests

```sh
bin/verify                                       # install, typecheck, every test area
TEST_POSTGRES_URL=postgres://postgres:x@127.0.0.1:5432/postgres bin/verify   # plus Postgres
VERIFY_URL=https://octowarden.example.com bin/verify                         # plus a /health probe
```

Each directory under `test/` runs in its own process, because `mock.module()` is process-wide.
GitHub is never called from tests: sections are tested against recorded answers in
`test/fixtures/<section>/` and a fake client that records every request.

New or changed sections, auth providers, the YAML format, migrations and CLI exit codes need
tests. Visible UI changes need a screenshot in the pull request, in both dark and light mode.

CI (`.github/workflows/run-checks.yml`) runs `bin/verify` with Postgres on every push and pull
request, and builds the image.

## Code layout

| Path | What |
|---|---|
| `src/sections/` | One file per template section: schema, read, diff, apply. Register it in `index.ts`. |
| `src/engine/` | Resolving sets, merging templates, values, plan, apply, audit |
| `src/templates/` | YAML schema (`octowarden/v1`), merge rules, built-in starter templates |
| `templates/` | The starter templates and the files they deliver |
| `src/auth/providers/` | GitHub credentials: `pat`, `gh`, `app` |
| `src/notifiers/` | Drift and failure notifications (`discord`) |
| `src/services/` | What the UI, API, MCP and CLI call |
| `src/routes/` | HTTP: `api/`, `ui/`, `octoforge.ts`, `mcp.ts`, `metrics.ts` |
| `src/mcp/tools/` | One file per MCP tool |
| `src/views/` | Server-rendered UI (JSX with `@kitajs/html`); `public/` holds static assets |
| `src/cli/` | The command line tool |
| `src/db/` | Kysely schema and migrations (one set for SQLite and Postgres) |

Conventions:

- Routes validate input, call a service, answer `{ok, message, ...}`. No business logic in routes.
- Every tunable is a key in `src/lib/settings.ts` with its default; nothing tunable is a constant.
- Migrations are additive: new tables and columns only, and they must run on SQLite and Postgres.
- A change that GitHub cannot make on a repository (plan or visibility limits) is skipped with the
  reason; it never fails the whole apply.
- Deleting anything (a repository, ruleset, label or webhook) is a destructive change and needs the
  typed confirmation. Bulk runs never apply destructive changes.
- Secrets never reach a log line, an export, an audit diff or an API answer.
- `public/tailor/` is vendored by [tailor](https://github.com/rojosinalma/tailor); do not edit it.

### Adding a section

1. Create `src/sections/<name>.ts` implementing `Section` from `src/sections/types.ts`.
2. Add one line to `src/sections/index.ts`.
3. Add fixtures and tests in `test/sections/`, and the section to [docs/templates.md](docs/templates.md).

## Commits and pull requests

- Pull request titles are [Conventional Commits](https://www.conventionalcommits.org)
  (`feat(sections): add environments`); release-please builds the changelog from them.
- Commits are GPG-signed.
- One topic per pull request; `bin/verify` green.

## Documentation

`README.md` stays short. Everything else is in `docs/`: [templates](docs/templates.md),
[configuration](docs/configuration.md), [command line](docs/cli.md), [API](docs/api.md),
[MCP](docs/mcp.md), [operations](docs/operations.md), [Octoforge](docs/octoforge.md),
[design](docs/SDD.md). Update the matching page in the same pull request.

## Releasing

release-please opens a release pull request from the commits on `main`. Merging it tags `vX.Y.Z`,
publishes the GitHub release, pushes `ghcr.io/rojosinalma/octowarden:X.Y.Z`, `X.Y`, `sha-<short>`
and `latest`, and attaches the bundled `octowarden` command line file.
