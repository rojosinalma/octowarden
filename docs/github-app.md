# GitHub access

Octowarden only calls GitHub; it receives no webhooks. It works with a GitHub App (recommended), a
personal access token, or the token of a logged-in GitHub CLI. **Settings → GitHub** shows what the
active credential grants next to what octowarden needs, which installation lacks what, and links to
the pages on GitHub where you fix it.

## Permissions

The table below mirrors `REQUIRED_PERMISSIONS` in `src/github/permissions.ts`; a test keeps them equal,
and `octoforge.json` and the App manifest are generated from the same list.

<!-- permissions:start -->
| Permission | Level | Used by | Why | Without it |
|---|---|---|---|---|
| `administration` | write | `settings`, `security`, `rulesets`, `protection`, `topics`, repo create (organization), repo delete | Changes repo settings, topics, security features, rulesets and branch protection; creates repos in an organization and deletes repos. | Settings, topics, security, rulesets and protection are skipped; repos cannot be created in an organization or deleted. |
| `contents` | write | `files`, `githooks`, branch picker | Reads files and branches; commits files and git hooks as one verified commit; creates the branch of a pull request. | Files and git hooks are skipped; the branch picker stays empty. |
| `pull_requests` | write | `labels`, `files` | Creates, changes and deletes labels (GitHub accepts Pull requests write for labels, so Issues is not needed); opens the pull request when a file entry sets `pr`. | Label changes and file changes with `pr` are skipped; direct commits still work. |
| `repository_hooks` | write | `webhooks` | Lists, creates, changes and deletes repository webhooks. | Webhooks are skipped. |
| `workflows` | write | `files` | GitHub requires it to write any file under .github/workflows. | File changes under .github/workflows are skipped; other files still work. |
| `actions` | read | environment picker | Lists the environments of a repo for the deployment pickers. | The environment picker stays empty; nothing else changes. |
| `checks` | read | status check picker | Reads check run names on the default branch for the required status check pickers. | The status check picker misses check runs; nothing else changes. |
| `statuses` | read | status check picker | Reads commit status contexts on the default branch for the required status check pickers. | The status check picker misses commit statuses; nothing else changes. |
| `members` | read | team picker | Lists the teams of an organization for the reviewer and bypass pickers. | The team picker stays empty; nothing else changes. |
| `metadata` | read | everything | Required by GitHub for every App; reads repos, topics and rulesets. | Nothing works: GitHub refuses every call. |
<!-- permissions:end -->

`members` is an organization permission: GitHub grants it only on installations on an organization, so octowarden never reports it missing on a personal account. Everything else is a repository permission. A fine-grained
token needs the same list.

A classic token needs these scopes:

<!-- scopes:start -->
| Scope | Why | Without it |
|---|---|---|
| `repo` | Full access to repos: settings, files, labels, topics, rulesets, protection, security. | Nothing works on private repos; changes fail on every repo. |
| `admin:repo_hook` | Manages repository webhooks. | Webhooks are skipped. |
| `delete_repo` | Deletes repos. | Repo delete fails; nothing else changes. |
| `workflow` | GitHub requires it to write any file under .github/workflows. | File changes under .github/workflows are skipped. |
| `read:org` | Lists organization teams for the pickers. | The team picker stays empty. |
<!-- scopes:end -->

### What happens when one is missing

When GitHub says for sure that a permission is missing (an App installation lists what it accepted;
a classic token sends its scopes), a plan moves the changes of every section that needs it to
**skipped** with the reason, for example `GitHub App lacks repository_hooks:write` or
`token lacks scope admin:repo_hook`. Nothing else in the plan changes. A fine-grained token does not
tell what it grants: its rows stay unknown and nothing is skipped; a missing permission then shows as
GitHub's own error when you apply.

The status is cached for `github_status_ttl_min` minutes (default 10). Changing a credential or
pressing **Re-check** asks GitHub again. The same answer is at `GET /api/github/status` (bearer
`API_TOKEN`, `?refresh=1` skips the cache) and in the MCP `health` tool as `github_access`.

## Create the App from Settings

With no App configured, **Settings → GitHub → App manifest** is open. Pick the account (your own, or an
organization your token can manage) and press **Create the App on GitHub**. GitHub shows the App with
the permissions above; confirm it. GitHub then sends you back to octowarden, which exchanges the
one-time code for the App ID, private key and webhook secret, stores them and switches the credential
mode to GitHub App. Last step: **Install the App** on the accounts whose repos octowarden manages.

GitHub sends you back to the `public_url` setting, or to the address of the page you started on when
it is empty. Set it when octowarden sits behind a different public name.

## Create the App by hand

The manifest Settings uses, with `<PUBLIC_URL>` for the address of your octowarden:

<!-- manifest:start -->
```json
{
  "name": "Octowarden",
  "url": "https://github.com/rojosinalma/octowarden",
  "description": "Reusable templates for repo settings, security, rulesets, labels, webhooks and files, applied with plan, apply and drift audit.",
  "public": false,
  "default_permissions": {
    "administration": "write",
    "contents": "write",
    "pull_requests": "write",
    "repository_hooks": "write",
    "workflows": "write",
    "actions": "read",
    "checks": "read",
    "statuses": "read",
    "members": "read",
    "metadata": "read"
  },
  "default_events": [],
  "hook_attributes": {
    "active": false
  },
  "redirect_url": "<PUBLIC_URL>/ui/github/app-created",
  "setup_url": "<PUBLIC_URL>/",
  "setup_on_update": false
}
```
<!-- manifest:end -->

Without the manifest:

1. Go to **Settings → Developer settings → GitHub Apps → New GitHub App** (for an organization:
   **Organization settings → Developer settings → GitHub Apps**).
2. Pick a name (names are unique across GitHub) and set the homepage to your octowarden address.
3. Turn **Webhook → Active** off. Octowarden needs no events.
4. Set the permissions from the table above.
5. Create the App, note its **App ID** and generate a **private key**.
6. Paste both into **Settings → GitHub** (App ID, App private key) and set **Credential** to GitHub App.
7. **Install App** on the accounts octowarden should manage. With one installation nothing else is
   needed; with several, octowarden picks the installation of each repo's owner by itself, or you pin
   one with **Installation ID**.

## Add a permission to an existing App

1. **Edit permissions on GitHub** (Settings → GitHub) opens the App's permission page. Add what is
   missing and save.
2. GitHub asks the owner of each installation to accept the new permissions. Until they do, the
   installation keeps the old ones. **Accept on the installation** and **Review on GitHub** on each
   installation row open that page.
3. Press **Re-check**.

## Octoforge

[Octoforge](https://github.com/rojosinalma/octoforge) can create the App and deliver it to
octowarden (`PUT /api/octoforge/github`). Settings then shows "delivered by octoforge"; the
permission check works the same way. When the delivered App lacks a permission, add it on the App
and accept it on the installation as above.
