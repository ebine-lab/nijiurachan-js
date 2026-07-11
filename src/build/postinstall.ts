import { join } from "node:path"
import { generateIndexTs } from "./plugins/generate-index-ts-detail"

/**
 * install後走るスクリプト。
 * index.tsだけ生成する。
 * @file
 */

const dir: string = join(import.meta.dir, "..")

await main()

async function main(): Promise<void> {
  await generateIndexTs({
    dir,
    excludePatterns: ["**/build", "**/test"],
  })
}
