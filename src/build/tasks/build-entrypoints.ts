import { glob } from "node:fs/promises"
import { join } from "node:path"
import { build } from "bun"
import { generateIndexTsUnplugin } from "../plugins/generate-index-ts"
import { tscUnplugin } from "../plugins/tsc"

export type BuildOnceOptions = {
  /** TypeScriptのソースフォルダ */
  dir: string
  /** ビルドエラーを例外にするかどうか */
  throwError: boolean
  /** 開発ビルドかどうか */
  buildFor: "production" | "development"
}

/**
 * TypeScriptをそれぞれバンドルする。
 * ts/entrypoints/pc.ts → public/assets/js/ts/pc.js
 * ts/entrypoints/sp.ts → public/assets/js/ts/sp.js
 */
export async function buildEntrypoints({
  dir,
  throwError,
  buildFor,
}: BuildOnceOptions): Promise<{ success: boolean }> {
  try {
    const entrypoints = await Array.fromAsync(
      glob([join(dir, "{elements,components,io,pure,util}/*.{ts,tsx}")], {
        exclude: ["**/index.ts"],
      }),
    )
    const prod = buildFor === "production"
    await build({
      entrypoints,
      root: dir,
      outdir: "dist",
      target: "browser",
      minify: buildFor === "production",
      sourcemap: "linked",
      splitting: buildFor === "production",
      external: [
        // アプリ側で用意するライブラリ
        "axnospaint-for-aimg",
        "preact",
        "zustand",
      ],
      define: {
        "import.meta.PROD": `${prod}`,
        "import.meta.DEV": `${!prod}`,
      },
      plugins: [
        generateIndexTsUnplugin.bun({
          dir,
          excludePatterns: ["**/build", "**/test"],
        }),
        tscUnplugin.bun({
          dir: join(dir, ".."),
        }),
      ],
    } satisfies Bun.BuildConfig)

    console.info("build ok at", new Date().toLocaleString("ja"))

    return { success: true }
  } catch (e) {
    console.warn("build failed at", new Date().toLocaleString("ja"))
    if (throwError) {
      throw e
    }

    return { success: false }
  }
}
