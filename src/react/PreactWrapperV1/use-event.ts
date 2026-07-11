import { useEffect, useRef } from "react"
import {
  ensureHostListenerFor,
  getOrCreateHandle,
  maybeRemoveHostListenerFor,
} from "./core/registry"

/**
 * 指定`fullKey`の`<CustomElementRegion>`上で発火する`eventName`を副作用型で購読する。
 *
 * - 再レンダ中の`callback`参照差し替えに対してリスナ張替えは起きない (最新参照はrefで保持)
 * - `useEffect`なのでマウント後の発火からキャッチ
 * - Regionがまだマウントされていなくてもハンドル/hostListenerは生成されるのでOK
 * - `eventName`の型は`GlobalEventHandlersEventMap`で narrowing される (要素側で
 *   `declare global`を拡張している範囲で)
 */
export function useEvent<K extends keyof GlobalEventHandlersEventMap>(
  fullKey: string,
  eventName: K,
  callback: (event: GlobalEventHandlersEventMap[K]) => void,
): void {
  const cbRef = useRef(callback)
  cbRef.current = callback

  useEffect(() => {
    const handle = getOrCreateHandle(fullKey)
    const name = eventName as string

    const wrapper = (e: Event): void => {
      cbRef.current(e as GlobalEventHandlersEventMap[K])
    }

    let set = handle.eventCallbacks.get(name)
    if (!set) {
      set = new Set()
      handle.eventCallbacks.set(name, set)
    }
    set.add(wrapper)
    ensureHostListenerFor(fullKey, name)

    return () => {
      set?.delete(wrapper)
      if (set?.size === 0) {
        handle.eventCallbacks.delete(name)
      }
      maybeRemoveHostListenerFor(fullKey, name)
    }
  }, [fullKey, eventName])
}
