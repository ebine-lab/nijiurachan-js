import { join } from "node:path"
import type { BuildOnceOptions } from "./tasks/build-entrypoints"
import { buildEntrypoints } from "./tasks/build-entrypoints"
import { watchAndRebuild } from "./tasks/watch-and-rebuild"

/**
 * ビルドスクリプトの常駐版。
 * tsフォルダを監視し、変更があるたびビルドする。
 * @file
 */

const dir: string = join(import.meta.dir, "..")
const config: BuildOnceOptions = {
  dir,
  throwError: false,
  buildFor: "development",
}

await main()

async function main(): Promise<void> {
  await buildEntrypoints(config)

  console.info("ファイルの変更を待ちます...")

  await watchAndRebuild(dir, () => buildEntrypoints(config))
}
