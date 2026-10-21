<!-- Title must be a conventional commit, e.g. `feat(sections): add environments section` or `fix(cli): exit 2 on drift`.
     release-please builds the changelog and the version bump from it. -->

## What

<!-- One or two sentences. Link the issue: Closes #123 -->

## Why

## Checklist

- [ ] `bin/verify` passes locally (typecheck, tests, smoke)
- [ ] New or changed sections come with diff/apply tests against recorded GitHub responses
- [ ] Destructive changes (deletes, visibility) still need the typed confirm
- [ ] `docs/` updated when a section field, setting, env var, CLI flag, API route or MCP tool changed
- [ ] No secret can reach a log line, an export, an audit diff or an API answer
