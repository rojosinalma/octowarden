import { describe, expect, test } from 'bun:test'
import { mergeConfig, mergeSections } from '../../src/templates/merge'
import { parseYaml, toYaml, YamlError } from '../../src/templates/schema'
import { MissingValuesError, placeholders, substitute } from '../../src/templates/values'
import { memoryLibrary, setToDoc, templateFromDoc, templateToDoc } from '../../src/templates/library'

const YAML = `apiVersion: octowarden/v1
kind: Template
metadata:
  name: base
  description: Squash only
spec:
  sections:
    settings:
      allow_squash_merge: true
      allow_merge_commit: false
      squash_merge_commit_title: PR_TITLE
      delete_branch_on_merge: true
      description: \${{ values.description }}
  requires:
    visibility: any
---
apiVersion: octowarden/v1
kind: Set
metadata:
  name: oss
spec:
  templates: [base]
  values:
    description: An open-source tool
---
apiVersion: octowarden/v1
kind: Manifest
spec:
  repos:
    - repo: octo-example/demo
      sets: [oss]
      values:
        description: Demo
`

describe('YAML documents', () => {
  test('parse and round-trip', () => {
    const docs = parseYaml(YAML)
    expect(docs.map((d) => d.kind)).toEqual(['Template', 'Set', 'Manifest'])
    const again = parseYaml(toYaml(docs))
    expect(again).toEqual(docs)
  })

  test('template doc ↔ model', () => {
    const [t] = parseYaml(YAML)
    if (t?.kind !== 'Template') throw new Error('expected a Template')
    expect(templateToDoc(templateFromDoc(t))).toEqual(t)
  })

  test('rejects unknown sections, bad section config, bad apiVersion with a path', () => {
    const bad = (s: string) => () => parseYaml(s)
    expect(bad('apiVersion: octowarden/v1\nkind: Template\nmetadata: {name: x}\nspec: {sections: {nope: {}}}')).toThrow(/unknown section "nope"/)
    expect(bad('apiVersion: octowarden/v1\nkind: Template\nmetadata: {name: x}\nspec: {sections: {settings: {has_wiki: "yes"}}}')).toThrow(
      /spec\.sections\.settings\.has_wiki/,
    )
    expect(bad('apiVersion: octowarden/v2\nkind: Set\nmetadata: {name: x}\nspec: {templates: [a]}')).toThrow(YamlError)
    expect(bad('apiVersion: octowarden/v1\nkind: Set\nmetadata: {name: Bad Name}\nspec: {templates: [a]}')).toThrow(/metadata\.name/)
    expect(bad('a: [')).toThrow(YamlError)
  })

  test('placeholder configs are validated after substitution, not at parse', () => {
    const docs = parseYaml('apiVersion: octowarden/v1\nkind: Template\nmetadata: {name: x}\nspec: {sections: {settings: {has_wiki: "${{ values.wiki }}"}}}')
    expect(docs).toHaveLength(1)
  })

  test('memory library serves templates and sets', async () => {
    const lib = memoryLibrary(parseYaml(YAML))
    expect((await lib.getTemplate('base'))?.requires).toEqual({ visibility: 'any' })
    const set = await lib.getSet('oss')
    expect(setToDoc(set!).spec.templates).toEqual(['base'])
  })
})

describe('values', () => {
  test('whole placeholder keeps the type, inline interpolates', () => {
    const out = substitute<unknown>({ a: '${{ values.flag }}', b: 'v${{values.n}}-x', c: ['${{ values.n }}'] }, { flag: true, n: 3 })
    expect(out).toEqual({ a: true, b: 'v3-x', c: [3] })
  })
  test('missing values are all named', () => {
    expect([...placeholders({ a: '${{ values.x }} ${{ values.y }}' })]).toEqual(['x', 'y'])
    try {
      substitute({ a: '${{ values.y }}', b: '${{ values.x }}' }, {})
      throw new Error('no throw')
    } catch (err) {
      expect(err).toBeInstanceOf(MissingValuesError)
      expect((err as MissingValuesError).missing).toEqual(['x', 'y'])
    }
  })
})

describe('merge', () => {
  test('objects deep-merge, later wins; arrays replace without a merge key', () => {
    expect(mergeConfig({ a: 1, o: { x: 1, y: 2 }, l: [1, 2] }, { o: { y: 3 }, l: [9] })).toEqual({ a: 1, o: { x: 1, y: 3 }, l: [9] })
  })
  test('arrays of keyed objects merge by the key', () => {
    const base = { labels: [{ name: 'bug', color: 'red' }, { name: 'docs', color: 'blue' }] }
    const next = { labels: [{ name: 'bug', color: 'orange' }, { name: 'new', color: 'green' }] }
    expect(mergeConfig(base, next, 'name')).toEqual({
      labels: [{ name: 'bug', color: 'orange' }, { name: 'docs', color: 'blue' }, { name: 'new', color: 'green' }],
    })
  })
  test('mergeSections merges per section in template order', () => {
    const out = mergeSections([{ settings: { has_wiki: true, allow_auto_merge: true } }, { settings: { has_wiki: false } }])
    expect(out).toEqual({ settings: { has_wiki: false, allow_auto_merge: true } })
  })
})
