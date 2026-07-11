import { glob, writeFile } from "node:fs/promises"
import {
  basename,
  dirname,
  extname,
  join,
  matchesGlob,
  relative,
} from "node:path"

export type GenerateIndexTsOptions = {
  /** index.tsを再帰的に生成するディレクトリ */
  dir: string
  /** index.tsを生成しないパターン */
  excludePatterns: string[]
}

/**
 * 各フォルダのindex.tsを再帰的に生成する。
 * 内容は `export * from "./<filename>"` の形。
 */
export async function generateIndexTs({
  dir,
  excludePatterns,
}: GenerateIndexTsOptions): Promise<void> {
  const dirToFilesMap = new Map<string, string[]>()

  for await (const file of glob(join(dir, "**", "*.{ts,tsx}"))) {
    if (excludePatterns.some((pattern) => matchesGlob(file, pattern))) {
      continue
    }
    if (matchesGlob(file, "**/{index.*,*.d.ts}")) {
      continue
    }
    const dir = dirname(file)
    const files = dirToFilesMap.get(dir) || []
    files.push(relative(dir, file))
    dirToFilesMap.set(dir, files)
  }

  await Promise.all(
    [...dirToFilesMap.entries()].map(([dir, files]) =>
      writeIndexTsFile(dir, files),
    ),
  )
}

async function writeIndexTsFile(dir: string, files: string[]): Promise<void> {
  const content = files
    .map(
      (file) =>
        `export ${file.endsWith(".d.ts") ? "type " : ""}* from "./${basename(file, extname(file))}"`,
    )
    .join("\n")

  await writeFile(join(dir, "index.ts"), content)
}
