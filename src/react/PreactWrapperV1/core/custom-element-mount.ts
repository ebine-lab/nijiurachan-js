/**
 * Custom Elementを、React VDOMから切り離された形で
 * placeholder要素にimperative appendChildする共通ロジック。
 *
 * 外部JSがホスト要素の子孫、あるいはホスト要素そのものを
 * `remove()` / `innerHTML = ""`で破壊してもReactのreconcilerは影響を受けない。
 */
export interface MountedHost {
  host: HTMLElement
  /** cleanup関数。placeholderからhostを外す。既に外れていても例外にしない */
  unmount: () => void
}

export function mountCustomElement(
  placeholder: HTMLElement,
  tag: string,
  /**
   * `connectedCallback`が参照する属性はここで設定する。
   * `appendChild`前に付けないと要素側でエラーになるケースがある。
   */
  initialAttributes: Record<string, string | undefined> = {},
): MountedHost {
  const host = document.createElement(tag)
  for (const [name, value] of Object.entries(initialAttributes)) {
    if (value !== undefined) {
      host.setAttribute(name, value)
    }
  }
  placeholder.appendChild(host)
  return {
    host,
    unmount: () => {
      // `placeholder.contains(host)` だと孫要素まで真になり、
      // 直下の子でない場合に `removeChild` が NotFoundError を吐く。
      // 直下の子に限定しつつ、外部JSが既に外している場合は何もしない。
      if (host.parentNode === placeholder) {
        placeholder.removeChild(host)
      }
    },
  }
}

/**
 * `host.setAttribute`をnull-safeに呼ぶ。`host`が既にDOMから切り離されていたら何もしない。
 * 属性値が`undefined`の場合は`removeAttribute`する。
 */
export function syncAttribute(
  host: HTMLElement | null,
  name: string,
  value: string | undefined,
): void {
  if (!host) {
    return
  }
  if (value === undefined) {
    host.removeAttribute(name)
  } else {
    host.setAttribute(name, value)
  }
}
