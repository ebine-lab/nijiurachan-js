import { join } from "node:path"
import { buildAndTest } from "./tasks/build-and-test"
import type { BuildOnceOptions } from "./tasks/build-entrypoints"
import { watchAndRebuild } from "./tasks/watch-and-rebuild"

/**
 * ビルドスクリプトの常駐版。
 * tsフォルダを監視し、変更があるたびビルドする。
 * ビルド後にテストもする。
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
  await buildAndTest(config)

  console.info("ファイルの変更を待ちます...")

  await watchAndRebuild(dir, () => buildAndTest(config))
}
