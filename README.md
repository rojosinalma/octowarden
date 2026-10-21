# Octowarden

[![run-checks](https://github.com/rojosinalma/octowarden/actions/workflows/run-checks.yml/badge.svg)](https://github.com/rojosinalma/octowarden/actions/workflows/run-checks.yml)
[![release](https://img.shields.io/github/v/release/rojosinalma/octowarden)](https://github.com/rojosinalma/octowarden/releases)
[![licence](https://img.shields.io/github/license/rojosinalma/octowarden)](LICENSE)

Octowarden keeps your GitHub repository configuration as reusable templates and applies them to
any repository, one at a time or in bulk. A template can set merge options, security features,
rulesets and branch protection, labels, topics, webhooks, files such as PR and issue templates or
`CODEOWNERS`, and git hooks. You combine templates into ordered sets, assign sets to repositories,
look at the plan (a diff against what GitHub has now), and apply it. A scheduled audit reports
drift, and every change lands in an audit trail: who, what, when, from where.

It comes as a web UI, a JSON API, an MCP server for agents, and a command line tool that also runs
on its own from YAML files.

## Requirements

- Docker with Compose v2.24 or newer, to run the server image; or [Bun](https://bun.sh) 1.4 or newer
  to run it from source
- Bun 1.4 or newer for the command line tool
- GitHub credentials: a personal access token (classic or fine-grained), a GitHub App, or a
  logged-in [GitHub CLI](https://cli.github.com) (command line tool only). Required permissions are in
  [docs/configuration.md](docs/configuration.md#github-credentials).
- Optional: PostgreSQL 14 or newer instead of the built-in SQLite database

## Installation

Server:

```sh
mkdir octowarden && cd octowarden
curl -fsSLO https://raw.githubusercontent.com/rojosinalma/octowarden/main/compose.yaml
curl -fsSL -o .env https://raw.githubusercontent.com/rojosinalma/octowarden/main/.env.example
chmod 600 .env && mkdir -p data      # set API_TOKEN (and GITHUB_TOKEN, or add it later in Settings)
docker compose up -d
```

Open <http://localhost:3000>. The UI has no login of its own and can change and delete
repositories: put it behind your reverse proxy's authentication before you expose it.

Command line tool: download `octowarden` from the
[latest release](https://github.com/rojosinalma/octowarden/releases/latest) and put it on your
`PATH`. It also installs as a GitHub CLI extension (`gh octowarden`); see [docs/cli.md](docs/cli.md).

## Usage

1. In **Templates**, start from the built-in starter templates (`base`, `security`, `protect-main`,
   `protect-dev`, `oss`, `fork`) or write your own; every section has a form.
2. In **Sets**, put templates in order (later ones win) and give default values, for example the
   required status checks.
3. In **Repos**, assign a set, open the plan, and apply it. Select several repositories to plan,
   apply or audit them in bulk.
4. **Audit** lists every change and every drift report.

The same from the terminal, without a server:

```sh
octowarden plan rojosinalma/example --set house          # exit 2 when changes are pending
octowarden apply rojosinalma/example --set house
octowarden plan acme/api -f my-templates.yaml --template base --value required_checks=build
octowarden audit -f manifest.yaml                         # every repo in the manifest
```

Templates, sets and manifests are YAML (`apiVersion: octowarden/v1`), described in
[docs/templates.md](docs/templates.md). More: [configuration](docs/configuration.md),
[command line](docs/cli.md), [JSON API](docs/api.md), [MCP](docs/mcp.md),
[operations](docs/operations.md), [Octoforge member contract](docs/octoforge.md),
[design](docs/SDD.md).

## Development

```sh
bun install
cp .env.example .env
bun run dev                         # http://localhost:3000, reloads on change
bin/verify                          # typecheck + tests (TEST_POSTGRES_URL=… adds the Postgres tests)
docker compose -f compose.yaml -f compose.dev.yaml up -d --build   # the same in a container
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[GNU Affero General Public License v3.0](LICENSE).
