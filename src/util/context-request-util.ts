/**
 * @file Context Protocolの実装 (subscribe除く)
 * @see https://github.com/webcomponents-cg/community-protocols/blob/main/proposals/context.md
 */

import type {
  Context,
  ContextCallback,
  ContextType,
  ContextRequestEvent as IContextRequestEvent,
  UnknownContext,
} from "."

/**
 * この要素かその親にコンテキストを要求する。
 * 値が同期ですぐ返ってくる前提。
 * @throws 供給がないとき
 * @return 供給があればその値
 */
export function requestContextFrom<K, V extends object>(
  elem: EventTarget,
  key: Context<K, V>,
): V {
  let value: V | undefined
  elem.dispatchEvent(
    new ContextRequestEvent(key, (v) => {
      value = v
    }),
  )
  if (!value) {
    throw Error(`No context value provided (synchronously) for ${key}`)
  }
  return value
}

/** この要素の子にコンテキストを提供する */
export function provideContextFor<K, V>(
  elem: HTMLElement,
  key: Context<K, V>,
  value: V,
  options?: AddEventListenerOptions,
): void {
  elem.addEventListener(
    "context-request",
    (e) => {
      if (e.context === key) {
        e.stopPropagation()
        e.callback(value)
      }
    },
    options,
  )
}

class ContextRequestEvent<T extends UnknownContext>
  extends Event
  implements IContextRequestEvent<T>
{
  constructor(
    readonly context: T,
    readonly callback: ContextCallback<ContextType<T>>,
  ) {
    super("context-request", { bubbles: true, composed: true })
  }
}
