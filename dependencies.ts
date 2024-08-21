import { Record, flow, identity } from "effect"

export const removeDependencies = (remove: (string | RegExp)[]) =>
  remove
    ? Record.filter<string, string>(
        (_: unknown, name: string) =>
          !remove.find((val) =>
            val instanceof RegExp ? val.test(name) : name.startsWith(val),
          ),
      )
    : identity<Record<string, string>>

export const removeCli = removeDependencies([/^\@effect\/cli$/])
export const serverPlatform = (platform: `node`) =>
  removeDependencies([/^\@effect\/platform\-(bun|browser)$/])

export const browser = flow(
  removeDependencies([/^\@effect\/platform\-(bun|node)$/]),
  removeCli,
)

export const cli = serverPlatform(`node`)

export const removeSchema = removeDependencies([/^\@effect\/schema$/])

export const removeAll = removeDependencies([/^\@effect\//])
