# Command line

`octowarden` plans, applies and audits repo configuration from the terminal. It works in two ways:

- **Standalone**: templates come from YAML files plus the built-in starter templates, and the CLI talks to
  GitHub itself. Nothing is stored anywhere; there is no database and no server.
- **Against a server**: `--server <url>` (or `OCTOWARDEN_SERVER`) sends every command to an octowarden
  instance through its [JSON API](api.md). Templates, sets, assignments and the audit trail live there.

## Install

The CLI is one file that needs [Bun](https://bun.sh) 1.3 or newer.

Download the `octowarden` asset from the [latest release](https://github.com/rojosinalma/octowarden/releases/latest)
and put it on your `PATH`:

```sh
install -m 0755 octowarden ~/.local/bin/octowarden
octowarden --version
```

Or run it from a checkout of the repo (after `bun install`):

```sh
ln -s "$PWD/bin/octowarden" ~/.local/bin/octowarden
```

To build the single file yourself: `bin/bundle-cli dist/octowarden`.

### As a GitHub CLI extension

`gh` runs any executable called `gh-<name>` from an installed extension directory. Put a copy of the file
named `gh-octowarden` in a directory of the same name and install that directory as a local extension:

```sh
mkdir -p ~/.local/share/octowarden/gh-octowarden
install -m 0755 octowarden ~/.local/share/octowarden/gh-octowarden/gh-octowarden
cd ~/.local/share/octowarden/gh-octowarden && gh extension install .
gh octowarden --help
```

Use a copy rather than a symlink for the inner file: the help text then shows `gh octowarden`. Without a
token in the environment the CLI uses the login of `gh` (`gh auth token`), so `gh octowarden plan …` works as
soon as `gh auth login` does.

## GitHub credentials (standalone)

The first one found wins:

1. `GITHUB_TOKEN`: a personal access token.
2. `gh auth token`: the GitHub CLI login.
3. `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` and `GITHUB_APP_INSTALLATION_ID`: a GitHub App installation.

The audit trail of a server is not involved in standalone runs; the "actor" is the GitHub login.

## Commands

| Command | What it does |
|---|---|
| `plan <owner/repo>` | Reads the repo and prints what would change. Writes nothing. |
| `apply <owner/repo>` | Plans, asks for confirmation, then writes the changes. |
| `sync` | Plans every repo of the Manifest documents, asks once, applies. With `--server` and no files: every repo that has sets assigned on the server. |
| `audit [<owner/repo>…]` | Compares repos with their sets. Without repos: every repo of the Manifest (standalone) or every assigned repo (server). |
| `templates [list]` / `templates show <name>` | Lists templates, or prints one as YAML. |
| `sets [list]` / `sets show <name>` | Lists sets, or prints one as YAML. |
| `sections` | Lists the configurable sections (settings, security, rulesets, …). |
| `export` | Prints templates and sets as YAML. `--template`/`--set` pick some; standalone without files prints the built-ins. |
| `import <file>` | With `--server`: stores the documents. Standalone: only checks the file and counts its documents. |
| `repos list` | Lists the repos the server knows (server only). |
| `repos create --name <n> --private\|--public` | Creates a repo (server only). `--owner`, `--description`, `--set` optional. |
| `repos delete <owner/repo> --confirm <owner/repo>` | Deletes a repo on GitHub (server only). Cannot be undone. |

## Flags

| Flag | Meaning |
|---|---|
| `-f, --file <yaml>` | YAML file with Template, Set or Manifest documents. Repeatable. |
| `-d, --dir <dir>` | Every `.yaml`/`.yml` file in the directory, sorted by name. Repeatable. |
| `--server <url>` | octowarden server; also `OCTOWARDEN_SERVER`. |
| `--token <token>` | API token for the server; also `OCTOWARDEN_TOKEN`. |
| `-s, --set <name>` | Set to apply, in the order given. Repeatable. |
| `-t, --template <name>` | Template to apply after the sets. Repeatable. |
| `--value key=value` | Value for a `${{ values.key }}` placeholder. Repeatable. `true`/`false` and integers keep their type. |
| `-y, --yes` | Apply without asking. Needed when stdin/stdout is not a terminal. |
| `--confirm <owner/repo>` | Allows destructive changes (deletes or overwrites) on that repo, and confirms `repos delete`. |
| `--json` | One JSON document on stdout, nothing else. |
| `--manifest` | `export` with `--server`: adds a Manifest of the repo assignments. |
| `-h, --help` | Help. |
| `-V, --version` | Version. |

Files win over built-in templates with the same name. Without `--set`/`--template`, `plan`, `apply` and
`audit` use the repo's entry in a Manifest file (standalone) or the sets assigned on the server.

Values: the set's own values come first, then the repo's Manifest values, then `--value` flags.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Done. For `plan`: no changes pending. For `audit`: every repo in sync. |
| 1 | Error, a refused confirmation, or a failed change. |
| 2 | `plan` found pending changes, or `audit` found drift. Always, no flag needed. |

## Safety

- `apply` and `sync` always show the plan first. On a terminal they ask `[y/N]`; anywhere else they refuse
  unless `--yes` is given.
- A plan with destructive changes (removing a ruleset, label or webhook, overwriting a file) is refused unless
  `--confirm owner/repo` names that exact repo. The refused changes are listed.
- `repos delete` needs `--confirm owner/repo` and, on a terminal, a second `y`.

## Output

Text output marks changes with `+` (create), `~` (update) and `-` (delete); destructive ones carry `!`.
Colours appear on a terminal only. `NO_COLOR` turns them off, `FORCE_COLOR=1` turns them on in a pipe.

`--json` shapes (they mirror the API answers):

| Command | Shape |
|---|---|
| `plan` | `{ok, message, plan: {id, repo, changes[], skipped[], destructive, …}}` |
| `apply` | `{ok, message, plan, report: {repo, status, applied, failed, results[], skipped[]}}` (`report: null` when nothing was pending) |
| `sync` | `{ok, message, results: [{repo, plan, report?, error?}], failures: [{repo, message}]}` |
| `audit` | `{ok, message, drifts: [{repo, state, changes[], message}]}` |
| `templates`, `sets` | `{ok, message, templates\|sets: [{name, description, builtin, detail}]}`; `show`: `{ok, message, yaml}` |
| `sections` | `{ok, message, sections: [{name, title, description}]}` |
| `export` | `{ok, message, yaml}` |
| `import` | `{ok, message, counts: {templates, sets, repos}, stored}` |
| errors | `{ok: false, message, code}` (plus `destructive[]` when a confirm is missing) |

With `--server`, `audit` reports per-repo state and summary but no change list; open the run in the UI
or `GET /api/runs/<id>` for details.

`OCTOWARDEN_LOG_LEVEL=debug` prints every GitHub call (standalone).

## Examples

```sh
# What would the house set change on one repo?
octowarden plan acme/api --set house --value required_checks=build,test

# Apply it without a prompt (CI)
octowarden apply acme/api --set house --value required_checks=build,test --yes

# Your own templates next to the built-ins, plus a Manifest of repos
octowarden sync -d ./octowarden --yes

# Nightly drift check: exit 2 means drift
octowarden audit -f repos.yaml --json > drift.json

# The same against a server
export OCTOWARDEN_SERVER=https://octowarden.example.com OCTOWARDEN_TOKEN=…
octowarden audit
octowarden repos create --name new-service --private --set house
```

A Manifest file lists repos and their sets:

```yaml
apiVersion: octowarden/v1
kind: Manifest
spec:
  repos:
    - repo: acme/api
      sets: [house]
      values:
        required_checks: build,test
    - repo: acme/web
      sets: [house]
```
