import { userInfo } from "node:os"
import { Prompt } from "@effect/cli"
import { Effect, Option } from "effect"
import { Template } from "./types.js"

const checkProjectName = Option.liftPredicate<string>((a) =>
  /^[0-9a-zA-Z\_\-]+$/.test(a),
)
const checkWorkspaceList = Option.liftPredicate<string>((a) =>
  /^[0-9a-zA-Z\_\-\,]+$/.test(a),
)
export const projectName = Prompt.text({
  message: `Project name`,
  validate: (val) =>
    checkProjectName(val).pipe(
      Effect.mapError(
        () => `Project name can only contain alphanumeric symbols _ and -`,
      ),
    ),
})

export const author = Prompt.text({
  message: `Author`,
  default: userInfo().username,
})

export const packages = Prompt.list({
  message: `List your package names separated by comma`,
  delimiter: `,`,
  validate: (val) =>
    checkWorkspaceList(val).pipe(
      Effect.mapError(
        () => `Package name can only contain alphanumeric symbols _ and -`,
      ),
    ),
})

export const linter = Prompt.select({
  message: `Choose your linter / formatter`,
  choices: [
    { title: `BiomeJS`, value: `biome` as const },
    { title: `ESLint`, value: `eslint` as const },
  ],
})

export const monorepo = Prompt.confirm({
  message: `Init monorepo?`,
  initial: false,
})

export const template = Prompt.select({
  message: `Install Effect packages`,
  choices: [
    { title: `Skip`, value: `none` as Template },
    { title: `Server app`, value: `server` as Template },
    { title: `Browser app`, value: `browser` as Template },
    { title: `CLI app`, value: `cli` as Template },
  ],
})

export const schema = Prompt.confirm({
  message: `Would you like Schema package to your project?`,
  initial: true,
})

export const vscode = Prompt.confirm({
  message: `Add VSCode configuration?`,
  initial: true,
})
