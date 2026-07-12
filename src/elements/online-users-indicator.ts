/** 同接数を表示するカスタムエレメント */
export class OnlineUsersIndicatorElement extends HTMLElement {
  static #fetchPromise: Promise<string> | undefined

  static define(): void {
    customElements.define("online-users-indicator", OnlineUsersIndicatorElement)
  }

  async connectedCallback(): Promise<void> {
    const count = await this.#fetch()
    if (count && /^\d+$/.test(count)) {
      this.textContent = `現在${count}人くらいが見てます.`
    }
  }

  #fetch(): Promise<string> {
    OnlineUsersIndicatorElement.#fetchPromise ??= fetch("/api/online-users")
      .then((res) => (res.ok ? res.text() : ""))
      .catch((e) => {
        console.warn("同接数取得に失敗しました", e)
        return ""
      })

    return OnlineUsersIndicatorElement.#fetchPromise
  }
}
