import { ImportDialog } from './templates'
import { Empty, Icon, PageHeader, jsonIsland } from './parts'
import type { RepoView, SetView, TemplateView, ValueField } from './types'

export type SetsData = { sets: SetView[]; usage: Record<string, number> }

export const SetsPage = ({ sets, usage }: SetsData) => (
  <>
    <PageHeader title="Sets" lead="Ordered templates plus default values; assign a set to repos.">
      <button class="t-btn" data-dialog-open="import-dlg">
        <Icon id="bi-upload" /> Import YAML
      </button>
      <a class="t-btn" href="/ui/export?all=1&manifest=1" download="octowarden.yaml">
        <Icon id="bi-download" /> Export everything
      </a>
      <a class="t-btn" data-variant="primary" href="/sets/new">
        <Icon id="bi-plus-lg" /> New set
      </a>
    </PageHeader>
    {sets.length ? (
      <div class="t-table-wrap">
        <table class="t-table" data-variant="data" data-density="compact" aria-label="Sets">
          <thead>
            <tr>
              <th>Set</th>
              <th>Templates, in order</th>
              <th class="t-col-num">Values</th>
              <th class="t-col-num">Repos</th>
              <th class="t-col-actions">
                <span class="t-visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {sets.map((s) => (
              <tr data-set={s.name}>
                <td>
                  <a href={`/sets/${s.name}`}>
                    <b safe>{s.name}</b>
                  </a>{' '}
                  {s.builtin ? (
                    <span class="t-badge" data-tone="info" data-size="xs">
                      built-in
                    </span>
                  ) : null}
                  {s.description ? (
                    <div class="t-small t-muted" safe>
                      {s.description}
                    </div>
                  ) : null}
                </td>
                <td>
                  <div class="t-cluster" data-gap="1">
                    {s.templates.map((t) => (
                      <a class="t-chip" data-tone="cyan" href={`/templates/${t}`} safe>
                        {t}
                      </a>
                    ))}
                  </div>
                </td>
                <td class="t-col-num">{String(Object.keys(s.values).length)}</td>
                <td class="t-col-num">{String(usage[s.name] ?? 0)}</td>
                <td class="t-col-actions">
                  <div class="t-cluster" data-gap="1">
                    {s.builtin ? (
                      <a class="t-btn" data-size="xs" href={`/sets/new?from=${encodeURIComponent(s.name)}`}>
                        <Icon id="bi-files" /> Duplicate to edit
                      </a>
                    ) : (
                      <a class="t-btn" data-size="xs" href={`/sets/${s.name}`}>
                        <Icon id="bi-pencil" /> Edit
                      </a>
                    )}
                    <a class="t-btn" data-size="xs" data-variant="ghost" data-icon="only" href={`/ui/export?sets=${encodeURIComponent(s.name)}&with=templates`} download={`${s.name}.yaml`} aria-label={`Export ${s.name}`} data-tip="Export YAML">
                      <Icon id="bi-download" />
                    </a>
                    {s.builtin ? null : (
                      <button class="t-btn" data-size="xs" data-variant="ghost" data-tone="danger" data-icon="only" data-action="set-delete" data-name={s.name} aria-label={`Delete ${s.name}`} data-tip="Delete">
                        <Icon id="bi-trash" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <Empty icon="bi-collection" title="No sets yet" text="A set lists templates in order; create one, then assign it to repos.">
        <a class="t-btn" data-variant="primary" href="/sets/new">
          <Icon id="bi-plus-lg" /> New set
        </a>
      </Empty>
    )}
    <ImportDialog />
  </>
)

export type SetEditData = {
  name?: string
  doc: SetView
  templates: TemplateView[]
  /** Placeholders per template name (kind inferred from the section schema). */
  fields: Record<string, ValueField[]>
  repos: RepoView[]
  /** Repos that have this set now. */
  assignedTo: string[]
  builtin?: boolean
  yaml: string
}

export const SetEditPage = ({ name, doc, templates, fields, repos, assignedTo, builtin, yaml }: SetEditData) => {
  const isNew = name === undefined
  if (builtin) {
    return (
      <>
        <PageHeader title={doc.name} lead="Built-in set, read-only." back={{ href: '/sets', label: 'Back to sets' }}>
          <button class="t-btn" data-action="set-assign-open" data-set={doc.name}>
            <Icon id="bi-github" /> Assign to repos…
          </button>
          <a class="t-btn" data-variant="primary" href={`/sets/new?from=${encodeURIComponent(doc.name)}`}>
            <Icon id="bi-files" /> Duplicate to edit
          </a>
        </PageHeader>
        <div class="t-stack" data-gap="3">
          {doc.description ? <p safe>{doc.description}</p> : null}
          <div class="t-code">
            <pre class="t-code-pre" safe>
              {yaml}
            </pre>
          </div>
        </div>
        <AssignDialog set={doc.name} repos={repos} assignedTo={assignedTo} />
      </>
    )
  }
  return (
    <>
      <PageHeader title={isNew ? 'New set' : doc.name} back={{ href: '/sets', label: 'Back to sets' }}>
        {isNew ? null : (
          <>
            <button class="t-btn" data-action="set-assign-open" data-set={doc.name}>
              <Icon id="bi-github" /> Assign to repos…
            </button>
            <a class="t-btn" href={`/ui/export?sets=${encodeURIComponent(doc.name)}&with=templates`} download={`${doc.name}.yaml`}>
              <Icon id="bi-download" /> Export YAML
            </a>
          </>
        )}
        <button class="t-btn" data-variant="primary" data-action="set-save" form="set-form">
          <Icon id="bi-check-circle" /> Save
        </button>
      </PageHeader>
      <div class="editor-split">
        <form class="t-form t-stack" data-gap="4" id="set-form" data-new={isNew ? 'true' : 'false'} novalidate>
          <div class="t-grid" data-cols="12">
            {isNew ? (
              <div class="t-field" data-span="6">
                <label class="t-label" for="set-title">
                  Name
                </label>
                <input class="t-input" id="set-title" name="title" value={doc.name} required maxlength="63" autocomplete="off" data-slug-target="set-name" />
                <p class="t-hint">
                  Stored as <code id="set-name" data-slug={doc.name} safe>{doc.name || '…'}</code>
                </p>
              </div>
            ) : (
              <div class="t-field" data-span="6">
                <span class="t-label">Name</span>
                <code id="set-name" data-slug={doc.name} safe>
                  {doc.name}
                </code>
              </div>
            )}
            <div class="t-field" data-span="6">
              <label class="t-label" for="set-desc">
                Description
              </label>
              <input class="t-input" id="set-desc" name="description" value={doc.description} maxlength="1000" />
            </div>
          </div>
          <section class="t-section">
            <h2 class="t-section-title">Templates, applied top to bottom (later ones win)</h2>
            <div class="t-section-body t-stack" data-gap="2">
              <ol class="t-list set-order" id="set-templates" aria-label="Templates in order"></ol>
              <p class="t-small t-muted" id="set-templates-empty" hidden>
                No templates yet: add one below.
              </p>
              <div class="t-toolbar" role="toolbar" aria-label="Add a template">
                <select class="t-select" data-size="sm" data-width="auto" id="add-template" aria-label="Template to add">
                  {templates.map((t) => (
                    <option value={t.name} safe>
                      {`${t.name}${t.builtin ? ' (built-in)' : ''}${t.description ? ` — ${t.description}` : ''}`}
                    </option>
                  ))}
                </select>
                <button class="t-btn" data-size="sm" type="button" data-action="template-add">
                  <Icon id="bi-plus-lg" /> Add template
                </button>
              </div>
            </div>
          </section>
          <section class="t-section">
            <h2 class="t-section-title">Default values</h2>
            <div class="t-section-body t-stack" data-gap="2">
              <p class="t-small t-muted">
                Values fill the <code>{'${{ values.key }}'}</code> placeholders of the templates; a repo may override each one.
              </p>
              <div class="t-settings" id="set-values"></div>
              <p class="t-small t-muted" id="set-values-empty" hidden>
                The chosen templates use no placeholders.
              </p>
            </div>
          </section>
        </form>
        <aside class="editor-preview t-stack" data-gap="2" aria-label="YAML preview">
          <div class="t-cluster" data-gap="2" data-align="center">
            <span class="t-label">YAML preview</span>
            <span class="t-badge" data-size="xs" data-tone="success" id="yaml-state">
              valid
            </span>
          </div>
          <p class="t-small t-feedback" data-tone="danger" id="yaml-error" hidden></p>
          <div class="t-code">
            <pre class="t-code-pre" id="yaml-preview" safe>
              {yaml}
            </pre>
          </div>
        </aside>
      </div>
      <script type="application/json" id="set-data">
        {jsonIsland({ name: name ?? null, assigned: assignedTo.length, doc, fields, templates: templates.map((t) => ({ name: t.name, builtin: Boolean(t.builtin), description: t.description })) })}
      </script>
      {isNew ? null : <AssignDialog set={doc.name} repos={repos} assignedTo={assignedTo} />}
    </>
  )
}

/** Searchable checkbox list of repos; ticked = the set is assigned there. */
export const AssignDialog = ({ set, repos, assignedTo }: { set: string; repos: RepoView[]; assignedTo: string[] }) => (
  <dialog class="t-dialog" id="assign-dlg" data-size="md" aria-labelledby="assign-dlg-title" data-set={set}>
    <form class="t-form" id="assign-form" novalidate>
      <div class="t-dialog-header">
        <h2 class="t-dialog-title" id="assign-dlg-title">
          Assign <span safe>{set}</span> to repos
        </h2>
        <button class="t-dialog-close" type="button" aria-label="Close" data-dialog-close>
          ×
        </button>
      </div>
      <div class="t-dialog-body t-stack" data-gap="2">
        {repos.length ? (
          <>
            <input class="t-input" data-size="sm" type="search" data-assign-filter placeholder="Filter repos" aria-label="Filter repos" />
            <fieldset class="t-check-group assign-list">
              <legend class="t-visually-hidden">Repositories</legend>
              {repos.map((r) => (
                <label class="t-check" data-name={r.full_name.toLowerCase()}>
                  <input class="t-check-input" type="checkbox" value={r.full_name} checked={assignedTo.includes(r.full_name)} data-was={assignedTo.includes(r.full_name) ? 'true' : 'false'} />
                  <span class="t-check-label">
                    <span safe>{r.full_name}</span>
                    <span class="t-check-desc" safe>
                      {r.sets.length ? `sets: ${r.sets.map((s) => s.set).join(', ')}` : 'no sets yet'}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
          </>
        ) : (
          <Empty icon="bi-github" title="No repos known" text="Open Repos and refresh from GitHub first." size="sm" />
        )}
      </div>
      <div class="t-dialog-footer">
        <button class="t-btn" type="button" data-dialog-close>
          Cancel
        </button>
        <button class="t-btn" type="submit" data-variant="primary">
          Save assignment
        </button>
      </div>
    </form>
  </dialog>
)
