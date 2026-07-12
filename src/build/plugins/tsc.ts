import { spawn } from "node:child_process"
import { createUnplugin, type UnpluginInstance } from "unplugin"

export type TscOptions = {
  /** チェックするディレクトリ */
  dir: string
}

/**
 * tscを走らせる。
 */
export async function tsc({ dir }: TscOptions): Promise<void> {
  const code = await new Promise<number | null>((resolve, reject) => {
    const p = spawn("tsc", ["--build", "--emitDeclarationOnly", dir], {
      stdio: "inherit",
    })
    p.on("close", resolve)
    p.on("error", reject)
  })

  if (code !== 0) {
    throw new Error(`tsc failed with exit code ${code}`)
  }
}

/** tscをビルドツールで使えるプラグインにしたもの */
export const tscUnplugin: UnpluginInstance<TscOptions, false> = createUnplugin(
  (opts: TscOptions) => ({
    name: "tsc",
    buildStart(): Promise<void> {
      return tsc(opts)
    },
  }),
)
