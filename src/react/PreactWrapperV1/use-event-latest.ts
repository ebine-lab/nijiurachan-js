import { useCallback, useRef, useSyncExternalStore } from "react"
import {
  ensureHostListenerFor,
  getOrCreateHandle,
  maybeRemoveHostListenerFor,
} from "./core/registry"
import type { LatestEventDetailProvider } from "./types"

type DetailOf<K extends keyof GlobalEventHandlersEventMap> =
  GlobalEventHandlersEventMap[K] extends CustomEvent<infer D> ? D : never

/**
 * 指定`fullKey`の`<CustomElementRegion>`から受信した`eventName`の**直近`CustomEvent.detail`**を値として返す。
 *
 * - selector省略時は detail そのものを返す
 * - selectorあり時は戻り値をキャッシュし、前回と同一参照なら consumer は再レンダされない
 *   (`useSyncExternalStore`の仕様上、`getSnapshot`が同値参照を返す必要があるため内部でrefキャッシュ)
 * - Regionがまだマウントされていない / イベント未受信の間は `undefined` (selectorも呼ばれない)
 * - 非CustomEvent (`Event`や標準 native) は detail を持たないので`T`は`never`で弾かれる
 */
export function useEventLatest<
  K extends keyof GlobalEventHandlersEventMap,
  T = DetailOf<K>,
>(
  fullKey: string,
  eventName: K,
  selector?: (detail: DetailOf<K>) => T,
): T | undefined {
  const name = eventName as string

  const subscribe = useCallback(
    (notify: () => void) => {
      const handle = getOrCreateHandle(fullKey)
      let set = handle.eventLatestSubscribers.get(name)
      if (!set) {
        set = new Set()
        handle.eventLatestSubscribers.set(name, set)
      }
      set.add(notify)
      ensureHostListenerFor(fullKey, name)
      return () => {
        set?.delete(notify)
        if (set?.size === 0) {
          handle.eventLatestSubscribers.delete(name)
        }
        maybeRemoveHostListenerFor(fullKey, name)
      }
    },
    [fullKey, name],
  )

  // `useSyncExternalStore`はgetSnapshotに同値参照を期待するため、直近detailと
  // selector結果をrefでキャッシュする。
  // selector自体が render 間で識別子変化した場合 (consumer 側でinline関数を渡している等) は
  // detailが同じでも再計算が必要なので、cacheRefにselectorも乗せて識別子で比較する。
  const cacheRef = useRef<{
    detail: DetailOf<K> | undefined
    selector: ((detail: DetailOf<K>) => T) | undefined
    selected: T | undefined
  }>({ detail: undefined, selector: undefined, selected: undefined })

  const getSnapshot = useCallback((): T | undefined => {
    const handle = getOrCreateHandle(fullKey)
    // push 済みかどうかは `has()` で判定する。`!== undefined` だと、非CustomEvent
    // (registry が `undefined` を入れる) や detail が `undefined` の CustomEvent を
    // 「未受信」扱いして pull 経路へ誤ってフォールバックしてしまう。
    const hasPushed = handle.latestEventDetails.has(name)
    const raw = hasPushed
      ? (handle.latestEventDetails.get(name) as DetailOf<K> | undefined)
      : ((
          handle.host as Partial<LatestEventDetailProvider> | null
        )?.getLatestEventDetail?.(name) as DetailOf<K> | undefined)
    if (raw === undefined) {
      if (cacheRef.current.detail !== undefined) {
        cacheRef.current = {
          detail: undefined,
          selector: undefined,
          selected: undefined,
        }
      }
      return undefined
    }
    if (
      cacheRef.current.detail === raw &&
      cacheRef.current.selector === selector
    ) {
      return cacheRef.current.selected
    }
    const next = selector ? selector(raw) : (raw as unknown as T)
    cacheRef.current = { detail: raw, selector, selected: next }
    return next
  }, [fullKey, name, selector])

  // SSR では registry を作らずに常に `undefined` を返す。
  // `getSnapshot` を server snapshot に流用すると `getOrCreateHandle` が
  // server レンダー時にレジストリ entry を作ってしまい、副作用となる。
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

function getServerSnapshot(): undefined {
  return undefined
}
