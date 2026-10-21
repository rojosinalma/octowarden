# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Entries after 0.1.0 are written by
release-please.

## 0.1.0

### Features

- Templates with nine sections: settings, security, rulesets, protection, labels, topics,
  webhooks, files and git hooks; sets with ordered templates and values.
- Plan, apply, sync and audit, one repository or in bulk, with typed confirmation for destructive
  changes and an audit trail.
- Built-in starter templates `base`, `security`, `protect-main`, `protect-dev`, `oss`, `fork` and
  the set `house`.
- Web UI, JSON API, MCP server, Prometheus metrics and a command line tool that also runs from
  YAML files without a server.
- GitHub credentials from a personal access token, a GitHub App or the GitHub CLI.
- SQLite by default, PostgreSQL in a named schema; Octoforge member contract v1.
