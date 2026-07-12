import { existsSync } from "node:fs"
import { join, resolve } from "node:path"
import type { Plugin } from "vite"
import type { ViteUserConfig } from "vitest/config"

// Vite 8 does not resolve the fallback array in package.json "imports" for .tsx files.
// This plugin ensures #js/<path> maps to src/<path>.ts or src/<path>.tsx.
function jsAliasPlugin(): Plugin {
  const srcRoot = resolve(__dirname, "src")
  return {
    name: "js-alias",
    enforce: "pre",
    resolveId(source: string): string | undefined {
      if (!source.startsWith("#js/")) return undefined
      const subpath = source.slice("#js/".length)
      for (const ext of [".ts", ".tsx"]) {
        const candidate = join(srcRoot, subpath + ext)
        if (existsSync(candidate)) return candidate
      }
      return undefined
    },
  }
}

const config: ViteUserConfig = {
  appType: "custom",
  root: "src",
  cacheDir: join(__dirname, ".bun", "vitest"),
  assetsInclude: ["**/*.html"],
  plugins: [jsAliasPlugin()],
  test: {
    environment: "jsdom",
    testTimeout: 10000,
  },
}

export default config
