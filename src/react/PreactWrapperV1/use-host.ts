import { useCallback, useSyncExternalStore } from "react"
import { peekHandle, subscribeHost } from "./core/registry"

/**
 * 指定`fullKey`の`<CustomElementRegion>`が現在マウントしているhost要素への参照を返す。
 *
 * - Regionがマウントされる前、または`useHost`より先にフックが動いているうちは`null`
 * - `attachHost` / `detachHost`のタイミングで再レンダが走る
 * - host要素の `method()` / `dispatchEvent()` など**imperativeな操作**を
 *   Reactツリー外からやりたい場合のescape hatch
 *   (イベント"受信"は`useEvent` / `useEventLatest`を、属性渡しは`CustomElementRegion`の
 *   `attributes`を使うこと)
 *
 * 参照が変わらない限り (= 同じhostがアタッチされ続ける間) は`useSyncExternalStore`の
 * 仕様に従い consumer は再レンダされない。
 */
export function useHost(fullKey: string): HTMLElement | null {
  const subscribe = useCallback(
    (notify: () => void) => subscribeHost(fullKey, notify),
    [fullKey],
  )
  const getSnapshot = useCallback(
    () => peekHandle(fullKey)?.host ?? null,
    [fullKey],
  )
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

function getServerSnapshot(): null {
  return null
}
