import { Empty, Icon, PageHeader, jsonIsland } from './parts'
import type { SectionInfo, TemplateView } from './types'

export type TemplatesData = { templates: TemplateView[]; sections: SectionInfo[] }

const sectionTitle = (sections: SectionInfo[], name: string) => sections.find((s) => s.name === name)?.title ?? name

export const TemplatesPage = ({ templates, sections }: TemplatesData) => (
  <>
    <PageHeader title="Templates" lead="Reusable pieces of repo configuration, one or more sections each.">
      <button class="t-btn" data-dialog-open="import-dlg">
        <Icon id="bi-upload" /> Import YAML
      </button>
      <a class="t-btn" href="/ui/export?all=templates" download="octowarden-templates.yaml">
        <Icon id="bi-download" /> Export all
      </a>
      <a class="t-btn" data-variant="primary" href="/templates/new">
        <Icon id="bi-plus-lg" /> New template
      </a>
    </PageHeader>
    {templates.length ? (
      <div class="t-table-wrap">
        <table class="t-table" data-variant="data" data-density="compact" aria-label="Templates">
          <thead>
            <tr>
              <th>Template</th>
              <th>Sections</th>
              <th class="t-col-shrink">Repos</th>
              <th class="t-col-actions">
                <span class="t-visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {templates.map((t) => (
              <tr data-template={t.name}>
                <td>
                  <a href={`/templates/${t.name}`}>
                    <b safe>{t.name}</b>
                  </a>{' '}
                  {t.builtin ? (
                    <span class="t-badge" data-tone="info" data-size="xs">
                      built-in
                    </span>
                  ) : null}
                  {t.description ? (
                    <div class="t-small t-muted" safe>
                      {t.description}
                    </div>
                  ) : null}
                </td>
                <td>
                  <div class="t-cluster" data-gap="1">
                    {Object.keys(t.sections).map((s) => (
                      <span class="t-chip" data-tone="cyan" safe>
                        {sectionTitle(sections, s)}
                      </span>
                    ))}
                  </div>
                </td>
                <td class="t-col-shrink">
                  {t.requires.visibility && t.requires.visibility !== 'any' ? (
                    <span class="t-badge" data-tone="neutral" safe>
                      {`${t.requires.visibility} only`}
                    </span>
                  ) : (
                    <span class="t-muted t-small">any</span>
                  )}
                </td>
                <td class="t-col-actions">
                  <div class="t-cluster" data-gap="1">
                    {t.builtin ? (
                      <a class="t-btn" data-size="xs" href={`/templates/new?from=${encodeURIComponent(t.name)}`}>
                        <Icon id="bi-files" /> Duplicate to edit
                      </a>
                    ) : (
                      <>
                        <a class="t-btn" data-size="xs" href={`/templates/${t.name}`}>
                          <Icon id="bi-pencil" /> Edit
                        </a>
                        <a class="t-btn" data-size="xs" data-variant="ghost" data-icon="only" href={`/templates/new?from=${encodeURIComponent(t.name)}`} aria-label={`Duplicate ${t.name}`} data-tip="Duplicate">
                          <Icon id="bi-files" />
                        </a>
                      </>
                    )}
                    <a class="t-btn" data-size="xs" data-variant="ghost" data-icon="only" href={`/ui/export?templates=${encodeURIComponent(t.name)}`} download={`${t.name}.yaml`} aria-label={`Export ${t.name}`} data-tip="Export YAML">
                      <Icon id="bi-download" />
                    </a>
                    {t.builtin ? null : (
                      <button class="t-btn" data-size="xs" data-variant="ghost" data-tone="danger" data-icon="only" data-action="template-delete" data-name={t.name} aria-label={`Delete ${t.name}`} data-tip="Delete">
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
      <Empty icon="bi-file-earmark-code" title="No templates yet" text="Create a template, or import YAML from another instance.">
        <a class="t-btn" data-variant="primary" href="/templates/new">
          <Icon id="bi-plus-lg" /> New template
        </a>
      </Empty>
    )}
    <ImportDialog />
  </>
)

export type TemplateEditData = {
  /** Undefined for a new template. */
  name?: string
  doc: { name: string; description: string; sections: Record<string, unknown>; requires: { visibility?: string } }
  sections: SectionInfo[]
  /** Built-in: read-only, YAML shown, "Duplicate to edit". */
  builtin?: boolean
  yaml: string
}

export const TemplateEditPage = ({ name, doc, sections, builtin, yaml }: TemplateEditData) => {
  const isNew = name === undefined
  const vis = doc.requires.visibility ?? 'any'
  if (builtin) {
    return (
      <>
        <PageHeader title={doc.name} lead="Built-in template, read-only." back={{ href: '/templates', label: 'Back to templates' }}>
          <a class="t-btn" data-variant="primary" href={`/templates/new?from=${encodeURIComponent(doc.name)}`}>
            <Icon id="bi-files" /> Duplicate to edit
          </a>
        </PageHeader>
        <div class="t-stack" data-gap="3">
          {doc.description ? <p safe>{doc.description}</p> : null}
          <div class="t-code">
            <pre class="t-code-pre" id="yaml-preview" safe>
              {yaml}
            </pre>
          </div>
        </div>
      </>
    )
  }
  return (
    <>
      <PageHeader title={isNew ? 'New template' : doc.name} back={{ href: '/templates', label: 'Back to templates' }}>
        <button class="t-btn" data-variant="primary" data-action="template-save" form="template-form">
          <Icon id="bi-check-circle" /> Save
        </button>
      </PageHeader>
      <div class="editor-split">
        <form class="t-form t-stack" data-gap="3" id="template-form" data-kind="Template" data-new={isNew ? 'true' : 'false'} novalidate>
          <div class="t-grid" data-cols="12">
            {isNew ? (
              <div class="t-field" data-span="6">
                <label class="t-label" for="tpl-title">
                  Name
                </label>
                <input class="t-input" id="tpl-title" name="title" value={doc.name} required maxlength="63" autocomplete="off" data-slug-target="tpl-name" />
                <p class="t-hint">
                  Stored as <code id="tpl-name" data-slug={doc.name} safe>{doc.name || '…'}</code>
                </p>
              </div>
            ) : (
              <div class="t-field" data-span="6">
                <span class="t-label">Name</span>
                <code id="tpl-name" data-slug={doc.name} safe>
                  {doc.name}
                </code>
              </div>
            )}
            <div class="t-field" data-span="6">
              <span class="t-label" id="tpl-vis-label">
                Applies to
              </span>
              <div class="t-segmented" role="group" aria-labelledby="tpl-vis-label" data-size="sm">
                {[
                  ['any', 'Any repo'],
                  ['public', 'Public only'],
                  ['private', 'Private only'],
                ].map(([v, l]) => (
                  <label class="t-segmented-item">
                    <input class="t-segmented-input" type="radio" name="visibility" value={v} checked={vis === v} />
                    <span>{l}</span>
                  </label>
                ))}
              </div>
            </div>
            <div class="t-field">
              <label class="t-label" for="tpl-desc">
                Description
              </label>
              <input class="t-input" id="tpl-desc" name="description" value={doc.description} maxlength="1000" />
            </div>
          </div>
          <div class="t-stack" data-gap="3" id="section-cards"></div>
          <div class="t-toolbar" role="toolbar" aria-label="Add a section">
            <select class="t-select" data-size="sm" data-width="auto" id="add-section" aria-label="Section to add">
              {sections.map((s) => (
                <option value={s.name} safe>
                  {`${s.title} — ${s.description}`}
                </option>
              ))}
            </select>
            <button class="t-btn" data-size="sm" type="button" data-action="section-add">
              <Icon id="bi-plus-lg" /> Add section
            </button>
          </div>
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
      <script type="application/json" id="sections-data">
        {jsonIsland(sections)}
      </script>
      <script type="application/json" id="template-data">
        {jsonIsland(doc)}
      </script>
    </>
  )
}

/** Upload or paste YAML (templates, sets, manifests); counts are toasted. */
export const ImportDialog = () => (
  <dialog class="t-dialog" id="import-dlg" data-size="lg" aria-labelledby="import-dlg-title">
    <form class="t-form" id="import-form" novalidate>
      <div class="t-dialog-header">
        <h2 class="t-dialog-title" id="import-dlg-title">
          Import YAML
        </h2>
        <button class="t-dialog-close" type="button" aria-label="Close" data-dialog-close>
          ×
        </button>
      </div>
      <div class="t-dialog-body t-stack" data-gap="3">
        <p class="t-small t-muted">
          Documents with <code>apiVersion: octowarden/v1</code> and kind Template, Set or Manifest. Existing names are replaced.
        </p>
        <div class="t-field">
          <label class="t-label" for="import-file">
            File
          </label>
          <input class="t-input" type="file" id="import-file" accept=".yaml,.yml,text/yaml" data-variant="drop" data-placeholder="Drop a .yaml file or choose one" />
        </div>
        <div class="t-field">
          <label class="t-label" for="import-text">
            Or paste
          </label>
          <textarea class="t-textarea t-mono" id="import-text" rows="12" spellcheck="false"></textarea>
          <p class="t-hint">Enter imports; Shift+Enter adds a new line.</p>
        </div>
      </div>
      <div class="t-dialog-footer">
        <button class="t-btn" type="button" data-dialog-close>
          Cancel
        </button>
        <button class="t-btn" type="submit" data-variant="primary">
          <Icon id="bi-upload" /> Import
        </button>
      </div>
    </form>
  </dialog>
)
