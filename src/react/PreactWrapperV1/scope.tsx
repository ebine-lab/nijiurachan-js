import type { JSX } from "react"
import { useContext } from "react"
import { ScopeContext } from "./core/scope-context"
import type { ScopeProps } from "./types"

/**
 * 配下の`<CustomElementRegion id="...">`のキー空間を分離するProvider。
 *
 * 初版はネスト禁止。既に親`Scope`が存在する場合は開発時エラー。
 * (運用上意味のあるユースケースが出るまでシンプルに保つ)
 */
export function Scope({ name, children }: ScopeProps): JSX.Element {
  const parent = useContext(ScopeContext)
  if (parent !== undefined) {
    throw new Error(
      `PreactWrapperV1.Scope: nested scope is not supported (parent="${parent}", attempted="${name}")`,
    )
  }
  if (!name) {
    throw new Error("PreactWrapperV1.Scope: name must be a non-empty string")
  }
  return <ScopeContext.Provider value={name}>{children}</ScopeContext.Provider>
}
