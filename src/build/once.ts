import { join } from "node:path"
import { buildAndTest } from "./tasks/build-and-test"
import type { BuildOnceOptions } from "./tasks/build-entrypoints"

/**
 * デプロイで使うビルドスクリプト。
 * @file
 */

const dir: string = join(import.meta.dir, "..")
const config: BuildOnceOptions = {
  dir,
  throwError: true,
  buildFor: "production",
}

await buildAndTest(config).catch((e) => {
  if (!e.message?.includes("tsc") && !e.message?.includes("Tests")) {
    throw e
  }
  process.exit(1)
})
