# Templates, sets and manifests

Every document is YAML with `apiVersion: octowarden/v1` and a `kind`. A file may hold several
documents separated by `---` (at most 500 documents, 5 MB). The UI edits the same documents and
exports them unchanged, so a template made in the UI works with the command line tool and the
other way round.

## Template

```yaml
apiVersion: octowarden/v1
kind: Template
metadata:
  name: protect-main            # lowercase letters, digits and dashes
  description: Ruleset on the default branch
spec:
  requires:
    visibility: public          # optional: public | private | any
  sections:
    rulesets:
      rulesets:
        - name: protect-main
          conditions: { ref_name: { include: ['~DEFAULT_BRANCH'] } }
          rules:
            deletion: true
            non_fast_forward: true
            required_status_checks: { contexts: '${{ values.required_checks }}' }
          bypass_actors: [admin]
```

A template gives configuration for one or more sections. Only what the template names is managed;
everything else on the repository stays as it is.

## Set

```yaml
apiVersion: octowarden/v1
kind: Set
metadata:
  name: house
spec:
  templates: [base, security, protect-main]   # applied in this order, later ones win
  values:
    required_checks: check
```

Templates merge in order: objects merge key by key, lists replace, except where a section names a
merge key (labels and rulesets by `name`, webhooks by `url`, files by `path`), which merge item by
item.

## Values

`${{ values.<key> }}` stands for a value. A string that is only a placeholder takes the value's type
(`true`, `3`); inside a longer string it is interpolated. Precedence, lowest first:

1. Built-in values for every repository: `owner`, `repo`, `full_name`, `default_branch`
2. The set's `values`
3. Values assigned with the set to one repository
4. Values given on the call (`--value key=value`, the API `values` field)

A plan names every missing value instead of guessing.

## Manifest

```yaml
apiVersion: octowarden/v1
kind: Manifest
spec:
  repos:
    - repo: acme/api
      sets: [house]
      values: { required_checks: 'build,test' }
    - repo: acme/docs
      sets: [house]
```

`octowarden sync -f manifest.yaml` plans and applies every listed repository; `audit` reports drift
for each. Importing a manifest on a server assigns the sets.

## Sections

| Section | Manages | Notes |
|---|---|---|
| `settings` | merge methods, squash and merge commit title/message, delete branch on merge, auto-merge, update branch, issues, wiki, projects, discussions, description, homepage, default branch | |
| `security` | Dependabot alerts and security updates, secret scanning, push protection, non-provider patterns, AI detection, Advanced Security, code security, private vulnerability reporting | features the repository's plan does not offer are skipped with the reason |
| `rulesets` | `{rulesets: [...], prune?}`: target, enforcement, `ref_name` include/exclude (`~DEFAULT_BRANCH`, bare branch names), rules (creation, update, deletion, non_fast_forward, required_signatures, required_linear_history, pull_request, required_status_checks), bypass actors (`admin` shorthand) | matched by name; `if_branch_exists` skips a ruleset when the branch is missing; private repositories on GitHub Free are skipped |
| `protection` | `{branches: [...]}`: classic branch protection per branch: status checks, admins, reviews, linear history, force pushes, deletions, conversation resolution, signatures | for repositories where rulesets are not available or not wanted |
| `labels` | `{labels: [{name, color, description}], prune?}` | `prune` deletes labels the template does not list |
| `topics` | `{topics: [...], mode: replace \| add}` | |
| `webhooks` | `{hooks: [{url, events, content_type, active, secret_ref}], prune?}` | https only; `secret_ref` names the `github_webhook_secret` setting or a `WEBHOOK_SECRET_*` environment variable, never the secret itself |
| `files` | `[{path, content \| content_ref, mode: overwrite \| create, branch?, pr?}]` | one commit per apply through GitHub's API (shown as Verified); `create` writes only missing files; `pr` proposes the change as a pull request |
| `githooks` | `{<hook>: <script>, readme?}` | written to `.githooks/` in the same commit as `files`; run `git config core.hooksPath .githooks` locally |

`octowarden sections` and `GET /api/sections` print the JSON Schema of every section.

## Destructive changes

Deleting a repository, or pruning a ruleset, label or webhook, is destructive. It needs the
repository's full name as confirmation (`--confirm owner/repo`, `{confirm}` in the API, typed in the
UI). Bulk runs report destructive changes as skipped and never apply them.

## Starter templates

| Name | What it does |
|---|---|
| `base` | squash merges only, PR title and body as the commit message, delete branch on merge, auto-merge and update branch on, wiki and projects off |
| `security` | Dependabot alerts and security updates, secret scanning and push protection where available, private vulnerability reporting |
| `protect-main` | ruleset `protect-main` on the default branch: no deletion, no force push, signed commits, required checks from `required_checks`, admins may bypass |
| `protect-dev` | the same for a `dev` branch, when it exists |
| `oss` | discussions, pull request and issue templates, `CODEOWNERS` and `SECURITY.md` when missing (public repositories) |
| `fork` | issues, wiki and projects off, delete branch on merge |
| `house` (set) | `base`, `security`, `protect-main` with `required_checks: check` |

Built-in names are reserved. Duplicate a starter template to change it.
