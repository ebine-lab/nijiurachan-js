/// <reference types="cloudflare-turnstile" />

declare global {
  interface Window {
    readonly turnstile?: Turnstile.Turnstile
  }
}

/**
 * Turnstileウィジェットのラッパ。フォームのフォーカス時初めて表示する
 */
export class LazyTurnstileElement extends HTMLElement {
  static formAssociated = true
  #internals = this.attachInternals()

  /** TurnstileウィジェットのID */
  #widgetId?: string

  /** Turnstileウィジェットを読み込みかけているプロミス */
  #turnstilePromise?: Promise<string>

  /** この要素をHTMLで使えるよう登録 */
  static define(): void {
    customElements.define("lazy-turnstile", LazyTurnstileElement)
  }

  connectedCallback(): void {
    this.#listen()
  }

  /** 入力欄のフォーカス時呼ばれる */
  async handleEvent(_e: Event): Promise<void> {
    await this.#activate()
  }

  /** フォーム内の選択に反応するようリスナ登録 */
  #listen(): void {
    const form = this.#internals.form
    if (!form) {
      throw new Error("lazy-turnstile element is not associated with a form")
    }

    form.addEventListener("focusin", this, { passive: true })
  }

  /** Turnstileウィジェットを実際表示する。表示済みなら再認証する */
  async #activate(): Promise<void> {
    if (window.turnstile && this.#widgetId) {
      window.turnstile.execute(this.#widgetId)
    } else {
      await this.#renderTurnstile()
    }
  }

  /** Turnstileを実際に表示 */
  async #renderTurnstile(): Promise<void> {
    this.#widgetId = await this.#loadTurnstile()
  }

  #makeConfig(): Turnstile.RenderParameters {
    return {
      sitekey: this.dataset.sitekey || "",
      size: "flexible",
      "refresh-expired": "manual",
      "refresh-timeout": "manual",
    }
  }

  /** Turnstileを読み込み */
  #loadTurnstile(): Promise<string> {
    this.#turnstilePromise ||= loadTurnstile(this.ownerDocument).then(
      (turnstile) => turnstile.render(this, this.#makeConfig()) || "",
    )

    return this.#turnstilePromise
  }
}

function loadTurnstile(doc: Document): Promise<Turnstile.Turnstile> {
  return new Promise((resolve, reject) => {
    if (window.turnstile) {
      resolve(window.turnstile)
      return
    }

    const script = doc.createElement("script")
    script.src =
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
    script.defer = true
    script.async = true
    script.onerror = reject
    script.onload = (): void => {
      if (window.turnstile) {
        resolve(window.turnstile)
      }
    }
    doc.head.appendChild(script)
  })
}
