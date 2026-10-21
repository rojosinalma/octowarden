# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Entries after 0.1.0 are written by
release-please.

## [0.2.0](https://github.com/rojosinalma/octowarden/compare/v0.1.0...v0.2.0) (2026-10-21)


### Features

* **github:** permission status, App manifest and multi-installation Apps ([2b09dd6](https://github.com/rojosinalma/octowarden/commit/2b09dd64d0483f3f43255cf1f349f92172823221))
* **octoforge:** sibling list switcher (PUT/DELETE /api/octoforge/siblings) ([ed09a52](https://github.com/rojosinalma/octowarden/commit/ed09a526e166871ad51b9c313ce7bec9ffce2389))
* **ui:** favicon and navbar mark in the octo tile style ([c4f8b72](https://github.com/rojosinalma/octowarden/commit/c4f8b723ecd85b00ac7f6fae48d65b6de1965be9))
* **ui:** house favicon (gruvbox plate, lucide shield-check) and matching navbar mark ([60dc527](https://github.com/rojosinalma/octowarden/commit/60dc5272ba72228187d3cff264918e7777d08d34))


### Bug fixes

* **github:** labels need pull_requests:write; drop issues from the manifest ([1a9dcf8](https://github.com/rojosinalma/octowarden/commit/1a9dcf8f6b5d658ab06002fe136d932246248a4a))
* **github:** organization permissions never count as missing on personal-account installations ([73cfb4e](https://github.com/rojosinalma/octowarden/commit/73cfb4e649af161f59c26d3331ef35587b3ebf28))
* **octoforge:** show the switcher only while Octoforge keeps the sibling list fresh ([0980aae](https://github.com/rojosinalma/octowarden/commit/0980aae9f7cfaac1f0bc45b9cae5c5b83a19e056))

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
