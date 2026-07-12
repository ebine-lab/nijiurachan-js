import { watch } from "node:fs/promises"
import { matchesGlob } from "node:path"
import debounce from "lodash-es/debounce"

export async function watchAndRebuild(
  dir: string,
  build: () => Promise<unknown>,
): Promise<void> {
  const rebuild = debounce(build, 500, {
    leading: false,
    trailing: true,
  })

  // bun --watch build がうまくいかず結局この形に落ち着いた
  // See https://github.com/oven-sh/bun/issues/5866
  for await (const { filename } of watch(dir, { recursive: true })) {
    if (filename && shouldRebuild(filename)) {
      await rebuild()
    }
  }
}

/** 引数のファイルが変更されたときビルドを再実行すべきかどうか */
function shouldRebuild(filename: string): boolean {
  return (
    matchesGlob(filename, "**/*.{ts,tsx,json,html}") &&
    !matchesGlob(filename, "**/{index.*,build/**}")
  )
}
