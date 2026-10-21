// Built-in file bodies for the files section (`content_ref`). Embedded at build time so the bundled CLI
// carries them; placeholders `${{ values.* }}` inside are substituted like any template value.
import bugReport from '../../templates/files/bug_report.yml' with { type: 'text' }
import codeowners from '../../templates/files/CODEOWNERS.txt' with { type: 'text' }
import featureRequest from '../../templates/files/feature_request.yml' with { type: 'text' }
import issueConfig from '../../templates/files/issue_config.yml' with { type: 'text' }
import prTemplate from '../../templates/files/pull_request_template.md' with { type: 'text' }
import security from '../../templates/files/SECURITY.md' with { type: 'text' }

export const BUILTIN_FILES: Readonly<Record<string, string>> = {
  'pull_request_template.md': prTemplate as string,
  'issue_config.yml': issueConfig as string,
  'bug_report.yml': bugReport as string,
  'feature_request.yml': featureRequest as string,
  'SECURITY.md': security as string,
  CODEOWNERS: codeowners as string,
}

export const BUILTIN_FILE_NAMES = Object.keys(BUILTIN_FILES) as [string, ...string[]]
