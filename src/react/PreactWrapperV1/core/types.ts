/**
 * Custom Elementインスタンス1つに対応する内部ハンドル。
 * `registry`で`fullKey -> handle`のマップを保持し、
 * ツリー外からフックで購読する際のハブとして使う。
 */
export interface InstanceHandle {
  /** レジストリ上のキー (`"scopeName:id"` または `"id"`) */
  fullKey: string
  /**
   * 対応するhost要素。
   * Regionがマウントされる前にフックが先に生成することもあるため、
   * アタッチされるまでの間は`null`。
   */
  host: HTMLElement | null
  /**
   * 購読者の要求に応じてhostに張ったEventListener。
   * host未アタッチの間も登録は保持され、`attachHost`時にまとめてhostに付ける。
   * どのイベントを張るかはgeneric body側は知らない (購読要求されたものだけ)。
   */
  hostListeners: Map<string, EventListener>
  /** 直近のCustomEvent `detail` (非CustomEventなら`undefined`) */
  latestEventDetails: Map<string, unknown>
  /** `useEventLatest`の購読者集合 (イベント名ごと) */
  eventLatestSubscribers: Map<string, Set<() => void>>
  /** `useEvent`の副作用コールバック (イベント名ごと) */
  eventCallbacks: Map<string, Set<(e: Event) => void>>
  /**
   * Regionの`localHandlers`を集約した単一マップ。
   * Region1個につき1イベント名1ハンドラ。
   * (Regionが2重にマウントされた場合は後勝ちの設計)
   */
  localHandlers: Map<string, (e: Event) => void>
  /**
   * `useHost`の購読者集合。
   * `attachHost` / `detachHost`で`host`フィールドが変化したタイミングでnotifyされる。
   */
  hostSubscribers: Set<() => void>
  /** 生きた`<CustomElementRegion>`の参照カウント */
  attachCount: number
}
