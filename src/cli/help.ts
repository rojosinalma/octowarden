/** `--help` text; `prog` is `octowarden` or `gh octowarden` when run as a gh extension. */
export function helpText(prog: string, version: string): string {
  return `octowarden ${version} — keep GitHub repos configured from reusable templates

Usage:
  ${prog} <command> [arguments] [flags]

Commands:
  plan <owner/repo>          Show what would change on the repo. Exit 2 when changes are pending.
  apply <owner/repo>         Plan, ask for confirmation, then write the changes to GitHub.
  sync                       Apply to every repo of the Manifest documents (or, with --server,
                             every repo that has sets assigned on the server).
  audit [<owner/repo>…]      Compare repos with their sets. Exit 2 when any repo drifts.
  templates [list|show <n>]  List templates, or print one as YAML.
  sets [list|show <n>]       List sets, or print one as YAML.
  sections                   List the configurable sections.
  export                     Print templates and sets as YAML (--template/--set narrow it).
  import <file>              Store the YAML on the server (needs --server); without a server
                             the file is only checked and counted.
  repos list                 List the repos the server knows (needs --server).
  repos create --name <n>    Create a repo (needs --server): --owner, --private|--public,
                             --description, --set.
  repos delete <owner/repo>  Delete a repo on GitHub (needs --server and --confirm owner/repo).

Where templates come from:
  -f, --file <yaml>          A YAML file with Template, Set or Manifest documents (repeatable).
  -d, --dir <dir>            Every .yaml/.yml file in a directory (repeatable).
                             Without --server the built-in templates are always available;
                             files win over built-ins with the same name.
  --server <url>             Use an octowarden server instead (env OCTOWARDEN_SERVER).
  --token <token>            API token for the server (env OCTOWARDEN_TOKEN).

What to apply:
  -s, --set <name>           A set, applied in the given order (repeatable).
  -t, --template <name>      A template, applied after the sets (repeatable).
  --value key=value          A value for \${{ values.key }} placeholders (repeatable);
                             true/false and integers keep their type.
                             Without --set/--template: the repo's entry in a Manifest file,
                             or with --server the sets assigned on the server.

Safety and output:
  -y, --yes                  Apply without asking (required when not on a terminal).
  --confirm <owner/repo>     Allow destructive changes (deletes, overwrites) on this repo.
  --json                     Print one JSON document instead of text.
  --manifest                 export: add a Manifest of the repo assignments (server only).
  -h, --help                 This help.
  -V, --version              Print the version.

GitHub credentials (without --server), first one found:
  GITHUB_TOKEN               A personal access token.
  gh auth token              The login of the GitHub CLI.
  GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_APP_INSTALLATION_ID
                             A GitHub App installation.

Colours follow the terminal; NO_COLOR turns them off, FORCE_COLOR=1 forces them on.

Exit codes:
  0  done, nothing pending
  1  error, refused or failed
  2  plan has pending changes, or audit found drift

Examples:
  ${prog} plan acme/api --set house
  ${prog} apply acme/api --set house --value required_checks=build,test --yes
  ${prog} audit -f repos.yaml --json
  ${prog} sync -d ./octowarden
  ${prog} plan acme/api --server https://octowarden.example.com
`
}
