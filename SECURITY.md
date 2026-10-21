# Security policy

## Reporting a vulnerability

Report privately through
[GitHub Security Advisories](https://github.com/rojosinalma/octowarden/security/advisories/new).
Do not open a public issue. You will get an acknowledgement within a week and a fix or a
statement before any public disclosure.

## Supported versions

Only the latest minor release receives fixes. Upgrade `ghcr.io/rojosinalma/octowarden` (or the
bundled CLI from the latest release) to the newest `X.Y` before reporting.

## What Octowarden holds

Octowarden changes repository settings and can create and delete repositories, so its credentials
carry administrative rights. Keep in mind:

1. GitHub credentials come from `.env` (`GITHUB_TOKEN`, `GITHUB_APP_*`), from the Settings page,
   or from the `gh` CLI login when you run the CLI. Values entered in Settings are stored in the
   database as plain text: protect the database file (or the Postgres role) like the token itself.
2. Tokens, the App private key and webhook secrets never appear in log lines, YAML exports, audit
   diffs or API answers. Templates reference webhook secrets by name, never by value.
3. The web UI has no login. Never expose an instance without an authenticating reverse proxy in
   front of it.
4. `/api/*` and `/mcp` require `Authorization: Bearer $API_TOKEN` and answer 503 while
   `API_TOKEN` is unset. `/api/octoforge/*` exists only when `OCTOFORGE_TOKEN` is set and requires
   that token.
5. Destructive changes (deleting a repository, a ruleset, a label or a webhook) need a typed
   confirmation of the repository's full name, in the UI, the CLI, the API and MCP alike. Bulk
   runs never apply destructive changes.
6. The container runs as a non-root user, needs no capabilities and no Docker socket. Mount only
   `.env` (read-only) and the `data` directory.
