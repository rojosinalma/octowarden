// Text imports (`with { type: 'text' }`) of built-in template files; Bun embeds them in bundles.
declare module '*.md' {
  const text: string
  export default text
}
