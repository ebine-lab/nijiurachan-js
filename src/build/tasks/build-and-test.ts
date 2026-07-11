import { type BuildOnceOptions, buildEntrypoints } from "./build-entrypoints"
import { runTests } from "./run-tests"

export async function buildAndTest(config: BuildOnceOptions): Promise<void> {
  const { success } = await buildEntrypoints(config)

  if (success) {
    const code = await runTests()
    if (code && config.throwError) {
      throw new Error(`Tests failed with code ${code}`)
    }
  }
}
