import path from "node:path"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"

import { Command } from "@effect/cli"
import { FileSystem } from "@effect/platform"
import { NodeContext, NodeRuntime } from "@effect/platform-node"
import { Effect, FiberRef, Record, flow } from "effect"
import * as deps from "./dependencies.js"
import * as prompts from "./prompts.js"
import { Template } from "./types.js"

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

const packageDir = dirname(fileURLToPath(import.meta.url))

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

const fromPackageFolder = (p: string) => path.join(packageDir, p)
const fromTemplateFolder = (p: string) => path.join(packageDir, `template`, p)

const maybeConfigVSCode = (args: Args) =>
	Effect.gen(function* () {
		const vscode = yield* prompts.vscode
		const fs = yield* FileSystem.FileSystem

		if (vscode) {
			yield* fs.makeDirectory(path.join(args.targetDir, `.vscode`))
			yield* Effect.all([
				fs.copyFile(
					fromTemplateFolder(`.vscode/extensions.json.${args.linter}`),
					path.join(args.targetDir, `.vscode`, `extensions.json`),
				),
				fs.copyFile(
					fromTemplateFolder(`.vscode/settings.json.${args.linter}`),
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
				const packageDir = path.join(
					args.targetDir,
					`packages`,
					packageName,
					`src`,
				)
				yield* fs.makeDirectory(packageDir, { recursive: true })

				// biome-ignore lint/suspicious/noExplicitAny: <explanation>
				const newPackageJson: Record<string, any> = {
					name: `@${args.projectName}/${packageName}`,
					author: args.author,
				}

				yield* fs.writeFileString(
					path.join(packageDir, `package.json`),
					JSON.stringify(newPackageJson, undefined, 2),
				)
				yield* fs.copyFile(
					fromTemplateFolder(`package/tsconfig.json`),
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
				fromPackageFolder(`template/biome.json`),
				path.join(targetDir, `biome.json`),
			)

			yield* modifyDependencies(
				`devDependencies`,
				Record.filter((_, name) => !name.toLowerCase().includes(`eslint`)),
			)
		} else {
			yield* fs.copyFile(
				fromPackageFolder(`template/eslint.config.js`),
				path.join(targetDir, `eslint.config.js`),
			)
			yield* modifyDependencies(
				`devDependencies`,
				Record.filter((_, name) => !name.toLowerCase().includes(`biome`)),
			)
		}

		yield* Effect.all([
			fs.copy(fromTemplateFolder(`.husky`), path.join(targetDir, `.husky`)),
			fs.copyFile(
				fromTemplateFolder(`.lintstagedrc.json.${linter}`),
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
		const targetDir = path.join(process.cwd(), projectName)
		const packageJson = yield* Effect.sync(() =>
			path.join(packageDir, `template`, `package.json`),
		).pipe(
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
						fromTemplateFolder(`gitignore.template`),
						path.join(targetDir, `.gitignore`),
					),
				),
			)
		const linterStep = setupLinter(args)
		const templateStep =
			template === `none` ? Effect.void : configureTemplate(template, args)

		const rootTsConfig = yield* Effect.sync(() =>
			path.join(packageDir, `template`, `tsconfig.json`),
		).pipe(
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
					? fs.makeDirectory(path.join(targetDir, `src`))
					: setupMonorepo(args).pipe(
							Effect.tap((packages) => {
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
					fromTemplateFolder(`tsconfig.base.json`),
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
	version: `v1.0.0-rc.4`,
})

Effect.suspend(() => cli(process.argv)).pipe(
	Effect.provide(NodeContext.layer),
	NodeRuntime.runMain,
)
