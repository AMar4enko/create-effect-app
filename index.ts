import path from "node:path"
import { Command } from "@effect/cli"
import { FileSystem } from "@effect/platform"
import { NodeContext, NodeRuntime } from "@effect/platform-node"
import { Effect, FiberRef, Record, flow } from "effect"
import * as deps from "./dependencies.js"
import packageJson, { version } from "./package.json"
import * as prompts from "./prompts.js"
import { Template } from "./types.js"

type PackageJSON = typeof packageJson

type Args = {
  targetDir: string
  author: string
  projectName: string
  linter: `biome` | `eslint`
}

type Dependencies = {
  devDependencies: Record<string, string>
  dependencies: Record<string, string>
}

const DependenciesRef = FiberRef.unsafeMake<Dependencies>({
  devDependencies: {},
  dependencies: {},
})

const modifyDependencies = (
  what: keyof Dependencies,
  f: (a: Record<string, string>) => Record<string, string>,
) =>
  FiberRef.getAndUpdate(DependenciesRef, (deps) => {
    const modified = f(deps[what])

    return {
      ...deps,
      [what]: modified,
    }
  })

const underCwd = path.join.bind(process.cwd())
const underTemplate = (p: string) => path.join(process.cwd(), `template`, p)

const maybeConfigVSCode = (args: Args) =>
  Effect.gen(function* () {
    const vscode = yield* prompts.vscode
    const fs = yield* FileSystem.FileSystem

    if (vscode) {
      yield* fs.makeDirectory(path.join(args.targetDir, `.vscode`))
      yield* Effect.all([
        fs.copyFile(
          underTemplate(`.vscode/extensions.json.${args.linter}`),
          path.join(args.targetDir, `.vscode`, `extensions.json`),
        ),
        fs.copyFile(
          underTemplate(`.vscode/settings.json.${args.linter}`),
          path.join(args.targetDir, `.vscode`, `settings.json`),
        ),
      ])
    }
  })

const setupMonorepo = (args: Args) =>
  Effect.gen(function* () {
    const packages = yield* prompts.packages

    const populatePackageDir = (packageName: string) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const packageDir = path.join(args.targetDir, `packages`, packageName)
        yield* fs.makeDirectory(packageDir, { recursive: true })

        const newPackageJson: Partial<PackageJSON> = {
          name: `@${args.projectName}/${packageName}`,
          author: args.author,
        }

        yield* fs.writeFileString(
          path.join(packageDir, `package.json`),
          JSON.stringify(newPackageJson, undefined, 2),
        )
        yield* fs.copyFile(
          underTemplate(`package/tsconfig.json`),
          path.join(packageDir, `tsconfig.json`),
        )
      })

    yield* Effect.forEach(packages, (p) => populatePackageDir(p))

    return packages
  })

const setupLinter = ({ linter, targetDir }: Args) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    if (linter === `biome`) {
      yield* fs.copyFile(
        underCwd(`template/biome.json`),
        path.join(targetDir, `biome.json`),
      )

      yield* modifyDependencies(
        `devDependencies`,
        Record.filter((_, name) => !name.toLowerCase().includes(`eslint`)),
      )
    } else {
      yield* fs.copyFile(
        underCwd(`template/eslint.config.js`),
        path.join(targetDir, `eslint.config.js`),
      )
      yield* modifyDependencies(
        `devDependencies`,
        Record.filter((_, name) => !name.toLowerCase().includes(`biome`)),
      )
    }

    yield* Effect.all([
      fs.copy(underTemplate(`.husky`), path.join(targetDir, `.husky`)),
      fs.copyFile(
        underTemplate(`.lintstagedrc.json.${linter}`),
        path.join(targetDir, `.lintstagedrc.json`),
      ),
    ])
  })

const configureTemplate = (template: Exclude<Template, `none`>, args: Args) =>
  Effect.gen(function* () {
    switch (template) {
      case `server`:
        return yield* modifyDependencies(
          `dependencies`,
          flow(deps.serverPlatform(`node`), deps.removeCli),
        )
      case `browser`:
        return yield* modifyDependencies(`dependencies`, deps.browser)
      case `cli`:
        return yield* modifyDependencies(`dependencies`, deps.cli)
    }
  })

const createEffectApp = Command.make(`create-effect-app`, {}, () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem

    const projectName = yield* prompts.projectName
    const targetDir = underCwd(projectName)
    const packageJson = yield* Effect.sync(() =>
      import.meta.resolve(`template/package.json`),
    ).pipe(
      Effect.map((path) => path.replace(`file://`, ``)),
      Effect.flatMap(fs.readFileString),
      Effect.flatMap((json) => Effect.try(() => JSON.parse(json))),
    )

    yield* DependenciesRef.pipe(
      FiberRef.set({
        dependencies: packageJson.dependencies,
        devDependencies: packageJson.devDependencies,
      }),
    )

    const author = yield* prompts.author
    const linter = yield* prompts.linter

    const template = yield* prompts.template

    const args = { author, projectName, targetDir, linter }

    const makeTargetDir = fs
      .makeDirectory(targetDir, { recursive: true })
      .pipe(
        Effect.zipRight(
          fs.copyFile(
            underTemplate(`.gitignore`),
            path.join(targetDir, `.gitignore`),
          ),
        ),
      )
    const linterStep = setupLinter(args)
    const templateStep =
      template === `none` ? Effect.void : configureTemplate(template, args)

    const rootTsConfig = yield* Effect.sync(() =>
      import.meta.resolve(`tsconfig.json`),
    ).pipe(
      Effect.map((path) => path.replace(`file://`, ``)),
      Effect.flatMap(fs.readFileString),
      Effect.flatMap((json) => Effect.try(() => JSON.parse(json))),
    )

    const schemaStep = prompts.schema.pipe(
      Effect.flatMap((needSchema) =>
        needSchema
          ? Effect.void
          : modifyDependencies(`dependencies`, deps.removeSchema),
      ),
    )

    const monorepoStep = prompts.monorepo.pipe(
      Effect.andThen((needMonorepo) => {
        return needMonorepo === false
          ? Effect.void
          : setupMonorepo(args).pipe(
              Effect.tap((packages) => {
                console.log(`We're here!`)
                delete rootTsConfig.include
                rootTsConfig.references = packages.map((packageName) => {
                  return {
                    path: `packages/${packageName}`,
                  }
                })
              }),
            )
      }),
    )

    const editorStep = maybeConfigVSCode(args)

    const tsConfigStep = Effect.suspend(() =>
      Effect.all([
        fs.copyFile(
          underTemplate(`tsconfig.base.json`),
          path.join(targetDir, `tsconfig.base.json`),
        ),
        fs.writeFileString(
          path.join(targetDir, `tsconfig.json`),
          JSON.stringify(rootTsConfig, undefined, 2),
        ),
      ]),
    )

    const packageJsonStep = FiberRef.get(DependenciesRef).pipe(
      Effect.andThen((deps) =>
        fs.writeFileString(
          path.join(targetDir, `package.json`),
          JSON.stringify(
            {
              ...packageJson,
              ...deps,
            },
            undefined,
            2,
          ),
        ),
      ),
    )

    yield* Effect.all([
      makeTargetDir,
      linterStep,
      templateStep,
      schemaStep,
      monorepoStep,
      editorStep,
      packageJsonStep,
      tsConfigStep,
    ])
  }),
)

const cli = Command.run(createEffectApp, {
  name: `Scaffold TypeScript + Effect app`,
  version: `v${version}`,
})

Effect.suspend(() => cli(process.argv)).pipe(
  Effect.provide(NodeContext.layer),
  NodeRuntime.runMain,
)
