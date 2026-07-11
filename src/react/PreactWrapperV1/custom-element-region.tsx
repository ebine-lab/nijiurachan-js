import type { JSX } from "react"
import { useContext, useEffect, useLayoutEffect, useRef } from "react"
import { mountCustomElement, syncAttribute } from "./core/custom-element-mount"
import { buildFullKey } from "./core/full-key"
import {
  attachHost,
  clearLocalHandler,
  detachHost,
  setLocalHandler,
} from "./core/registry"
import { ScopeContext } from "./core/scope-context"
import type { CustomElementRegionProps } from "./types"

/**
 * Custom Elementを「Reactに管理されない箱」として置くための汎用コンポーネント。
 *
 * - React VDOMにはplaceholderの`<div>`だけを描画し、`<props.tag>`は
 *   `useLayoutEffect`内で`document.createElement`してappendChild
 * - 内部のDOM (はっちゃんのcanvas等) が外部JSに破壊されてもReactは影響を受けない
 * - hostにどのイベントを張るかはgeneric body側では決めない。購読要求 (useEvent /
 *   useEventLatest / localHandlers) が来たタイミングでregistryが遅延登録する
 * - `data-*`含む属性は`attributes` propでそのまま渡す (要素固有の対応表は持たない)
 * - CustomEventの型narrowingは`GlobalEventHandlersEventMap`拡張に委ねる
 */
export function CustomElementRegion(
  props: CustomElementRegionProps,
): JSX.Element {
  const scopeName = useContext(ScopeContext)
  const fullKey = buildFullKey(scopeName, props.id)

  const placeholderRef = useRef<HTMLDivElement | null>(null)
  const hostRef = useRef<HTMLElement | null>(null)

  // 最新propsを常に参照できるref (localHandlersの参照差し替えでlistener張り直し不要)
  const propsRef = useRef(props)
  propsRef.current = props

  // 前回renderで`attributes`に含まれていたキー集合。次回render時に
  // 「今回 props.attributes に居なくなったキー」を host から `removeAttribute` するために使う。
  const prevAttrKeysRef = useRef<Set<string>>(new Set())

  // ------- マウント/アンマウント -------
  useLayoutEffect(() => {
    const placeholder = placeholderRef.current
    if (!placeholder) {
      return
    }

    // `connectedCallback`が参照する属性はappendChild前に付与しないとエラー
    const initialAttrs = propsRef.current.attributes ?? {}

    const mounted = mountCustomElement(placeholder, props.tag, initialAttrs)
    hostRef.current = mounted.host
    // `mountCustomElement`が`setAttribute`したキーを「前回キー」基準値として記録。
    // 以降のattributes同期useEffectが「消えたキー」を検出できるようになる。
    prevAttrKeysRef.current = new Set(Object.keys(initialAttrs))
    attachHost(fullKey, mounted.host)

    // localHandlersのキー集合はマウント時にスナップショット (動的追加は未対応)
    const handlerNames = Object.keys(propsRef.current.localHandlers ?? {})
    for (const name of handlerNames) {
      setLocalHandler(fullKey, name, (e: Event) => {
        const map = propsRef.current.localHandlers as
          | Record<string, (e: Event) => void>
          | undefined
        map?.[name]?.(e)
      })
    }

    return () => {
      for (const name of handlerNames) {
        clearLocalHandler(fullKey, name)
      }
      mounted.unmount()
      detachHost(fullKey, mounted.host)
      hostRef.current = null
      prevAttrKeysRef.current = new Set()
    }
  }, [fullKey, props.tag])

  // ------- 属性同期 (マウント後の変更分) -------
  useEffect(() => {
    const host = hostRef.current
    if (!host) {
      return
    }
    const attrs = props.attributes ?? {}
    const currentKeys = new Set(Object.keys(attrs))
    // 今回propsから消えたキーは host から実際に取り除く
    for (const prevName of prevAttrKeysRef.current) {
      if (!currentKeys.has(prevName)) {
        host.removeAttribute(prevName)
      }
    }
    for (const [name, value] of Object.entries(attrs)) {
      syncAttribute(host, name, value)
    }
    prevAttrKeysRef.current = currentKeys
  }, [props.attributes])

  return (
    <div
      ref={placeholderRef}
      className={props.className}
      style={props.style}
      data-preact-wrapper-v1-key={fullKey}
      // React側はこのdivの中身を一切管理しない (上書きも再レンダも起きない)
      suppressHydrationWarning
    />
  )
}
