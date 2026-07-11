import type { Context } from "react"
import { createContext } from "react"

/**
 * `<Scope name="...">`の配下で共有される名前空間名。
 * `undefined`の場合はスコープなし (fullKey = id そのまま)。
 */
export const ScopeContext: Context<string | undefined> = createContext<
  string | undefined
>(undefined)
