import type { InstanceHandle } from "./types"

/**
 * `fullKey -> InstanceHandle`のモジュール内シングルトンレジストリ。
 * `<CustomElementRegion>`のマウントとフック群 (useEvent / useEventLatest) の両方が参照する。
 *
 * どのイベントをhostに`addEventListener`するかは「遅延」: 購読要求 (`useEvent` /
 * `useEventLatest`の購読、Regionの`localHandlers`) が来たタイミングで張り、
 * 購読者ゼロになったら外す。これによりgeneric body側はイベント名を一切知らなくて済む。
 */
const registry: Map<string, InstanceHandle> = new Map()

/** ハンドル取得。無ければ新規作成する (フックが要素より先に走るケース対応) */
export function getOrCreateHandle(fullKey: string): InstanceHandle {
  const existing = registry.get(fullKey)
  if (existing) {
    return existing
  }
  const handle: InstanceHandle = {
    fullKey,
    host: null,
    hostListeners: new Map(),
    latestEventDetails: new Map(),
    eventLatestSubscribers: new Map(),
    eventCallbacks: new Map(),
    localHandlers: new Map(),
    hostSubscribers: new Set(),
    attachCount: 0,
  }
  registry.set(fullKey, handle)
  return handle
}

/** ハンドル取得 (無ければundefined、副作用なし) */
export function peekHandle(fullKey: string): InstanceHandle | undefined {
  return registry.get(fullKey)
}

/**
 * `<CustomElementRegion>`マウント時のアタッチ。既存の`hostListeners`を全部hostに付け直す。
 *
 * 同じfullKeyで再マウントされた場合 (Region remount等)、push経路に積まれた古い`detail`は
 * 古いhost由来で新hostの状態とは無関係なのでクリアする。pull経路 (`getLatestEventDetail`)
 * は新hostから取り直される。
 *
 * `latestEventDetails`をクリアした以上、`useEventLatest`の購読者にも`getSnapshot`を
 * 再評価させないと「古い値のまま固まる」ので、`notifyEventLatestSubscribers`で全件通知する。
 *
 * 既に別のhostがattach済みのまま再attachされた場合 (Strict Modeの2重mount等で
 * detachを挟まずに来るケース)、古いhostに付けた listener を先に外してからhostを差し替える。
 * これを忘れると、古いDOM要素にlistenerが残り続けてリーク + 二重dispatchの原因になる。
 */
export function attachHost(fullKey: string, host: HTMLElement): void {
  const handle = getOrCreateHandle(fullKey)
  const hadPreviousHost = handle.host !== null
  if (handle.host && handle.host !== host) {
    for (const [name, listener] of handle.hostListeners) {
      handle.host.removeEventListener(name, listener)
    }
  }
  handle.latestEventDetails.clear()
  handle.host = host
  // host差し替え (detachを挟まずに再attach) 経路では attachCount を増やさない。
  // 増やすと対応する detachHost が来たときに 0 まで戻らず maybeDeleteHandle が解放できない。
  if (!hadPreviousHost) {
    handle.attachCount++
  }
  for (const [name, listener] of handle.hostListeners) {
    host.addEventListener(name, listener)
  }
  notifyHostSubscribers(handle)
  notifyEventLatestSubscribers(handle)
}

/**
 * `<CustomElementRegion>`アンマウント時のデタッチ。購読者が残っていてもハンドルは保持する。
 *
 * push経路に積まれていた`detail`はhost固有のスナップショットなので、ここでもクリアする。
 * (pull経路は再attachまで`undefined`相当)
 *
 * クリア後は `useEventLatest`購読者にも通知して `getSnapshot` を再評価させる
 * (= host消えたので`undefined`が返るようになったことを反映させる)。
 *
 * `handle.host !== host` の stale detach (host差し替えで既に離脱済みの古いhostに対する
 * cleanup effectが遅れて来たケース) は完全に no-op 扱いする。`attachHost` 側で host
 * 差し替え経路では `attachCount` を増やしていないので、ここで減らすと現役 host が
 * attach されたままハンドルが解放されてしまう。
 */
export function detachHost(fullKey: string, host: HTMLElement): void {
  const handle = registry.get(fullKey)
  if (!handle) {
    return
  }
  if (handle.host !== host) {
    return
  }
  for (const [name, listener] of handle.hostListeners) {
    host.removeEventListener(name, listener)
  }
  handle.host = null
  handle.latestEventDetails.clear()
  notifyHostSubscribers(handle)
  notifyEventLatestSubscribers(handle)
  handle.attachCount--
  maybeDeleteHandle(handle)
}

/**
 * `useHost`の購読登録。`notify`は`host`フィールドが変化した (attach/detach) タイミングで呼ばれる。
 * 戻り値はunsubscribe関数。
 */
export function subscribeHost(fullKey: string, notify: () => void): () => void {
  const handle = getOrCreateHandle(fullKey)
  handle.hostSubscribers.add(notify)
  return () => {
    const current = registry.get(fullKey)
    if (!current) {
      return
    }
    current.hostSubscribers.delete(notify)
    maybeDeleteHandle(current)
  }
}

/**
 * `eventName`の購読者が1人以上いるなら、hostにlistenerを1本確実に張る。
 * Regionマウントより先にフックが走っても、後で`attachHost`が同じlistenerを付ける。
 */
export function ensureHostListenerFor(
  fullKey: string,
  eventName: string,
): void {
  const handle = getOrCreateHandle(fullKey)
  if (handle.hostListeners.has(eventName)) {
    return
  }
  const listener: EventListener = (e: Event) =>
    dispatchToSubscribers(handle, eventName, e)
  handle.hostListeners.set(eventName, listener)
  if (handle.host) {
    handle.host.addEventListener(eventName, listener)
  }
}

/**
 * `eventName`の購読者が全員消えたら、hostからlistenerを外す。
 * 購読が残っている場合は何もしない。
 */
export function maybeRemoveHostListenerFor(
  fullKey: string,
  eventName: string,
): void {
  const handle = registry.get(fullKey)
  if (!handle) {
    return
  }
  if (hasSubscriberFor(handle, eventName)) {
    return
  }
  const listener = handle.hostListeners.get(eventName)
  if (listener && handle.host) {
    handle.host.removeEventListener(eventName, listener)
  }
  handle.hostListeners.delete(eventName)
  handle.latestEventDetails.delete(eventName)
  maybeDeleteHandle(handle)
}

/** Regionが自身の`localHandlers[eventName]`をregistryに預ける */
export function setLocalHandler(
  fullKey: string,
  eventName: string,
  handler: (e: Event) => void,
): void {
  const handle = getOrCreateHandle(fullKey)
  handle.localHandlers.set(eventName, handler)
  ensureHostListenerFor(fullKey, eventName)
}

/** Regionがアンマウント/props変更で自身の`localHandlers[eventName]`を解除 */
export function clearLocalHandler(fullKey: string, eventName: string): void {
  const handle = registry.get(fullKey)
  if (!handle) {
    return
  }
  handle.localHandlers.delete(eventName)
  maybeRemoveHostListenerFor(fullKey, eventName)
}

/** テスト用: レジストリを空にする */
export function __resetRegistryForTest(): void {
  registry.clear()
}

// ---- 内部ヘルパ ----

function dispatchToSubscribers(
  handle: InstanceHandle,
  eventName: string,
  e: Event,
): void {
  if (e instanceof CustomEvent) {
    handle.latestEventDetails.set(eventName, e.detail)
  } else {
    handle.latestEventDetails.set(eventName, undefined)
  }

  const latestSubs = handle.eventLatestSubscribers.get(eventName)
  if (latestSubs) {
    for (const notify of latestSubs) {
      notify()
    }
  }

  const callbacks = handle.eventCallbacks.get(eventName)
  if (callbacks) {
    for (const cb of callbacks) {
      try {
        cb(e)
      } catch (err) {
        console.error(`PreactWrapperV1: "${eventName}" callback threw`, err)
      }
    }
  }

  const local = handle.localHandlers.get(eventName)
  if (local) {
    try {
      local(e)
    } catch (err) {
      console.error(
        `PreactWrapperV1: local handler for "${eventName}" threw`,
        err,
      )
    }
  }
}

function hasSubscriberFor(handle: InstanceHandle, eventName: string): boolean {
  const latestSize = handle.eventLatestSubscribers.get(eventName)?.size ?? 0
  const cbSize = handle.eventCallbacks.get(eventName)?.size ?? 0
  const hasLocal = handle.localHandlers.has(eventName)
  return latestSize > 0 || cbSize > 0 || hasLocal
}

function notifyHostSubscribers(handle: InstanceHandle): void {
  for (const notify of handle.hostSubscribers) {
    notify()
  }
}

/**
 * 全イベント名の`useEventLatest`購読者に通知する。
 * `latestEventDetails`を一括クリアした後に呼ぶ用 (個別`dispatchToSubscribers`は対象イベントだけ通知すればよい)。
 */
function notifyEventLatestSubscribers(handle: InstanceHandle): void {
  for (const subs of handle.eventLatestSubscribers.values()) {
    for (const notify of subs) {
      notify()
    }
  }
}

function maybeDeleteHandle(handle: InstanceHandle): void {
  if (
    handle.attachCount <= 0 &&
    handle.hostListeners.size === 0 &&
    handle.eventCallbacks.size === 0 &&
    handle.eventLatestSubscribers.size === 0 &&
    handle.localHandlers.size === 0 &&
    handle.hostSubscribers.size === 0
  ) {
    registry.delete(handle.fullKey)
  }
}
