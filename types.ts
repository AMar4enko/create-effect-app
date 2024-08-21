export type Template = `cli` | `server` | `browser` | `none`

export type Features = {
  template: Exclude<Template, `server`>
} & {
  template: `server`
  runtime: `node` | `bun`
}
