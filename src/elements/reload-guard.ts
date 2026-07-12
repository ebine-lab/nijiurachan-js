/** お絵描き中ホイールリロードを止めるやつ */
export class ReloadGuardElement extends HTMLElement {
  #workers!: Element[]
  isFullReload: boolean = false

  /** この要素をHTMLで使えるよう登録 */
  static define(): void {
    customElements.define("reload-guard", ReloadGuardElement)
  }

  connectedCallback(): void {
    this.#workers = this.dataset.workers
      ? [...this.querySelectorAll(this.dataset.workers)]
      : []
    this.isFullReload = this.dataset.isFullReload !== undefined
    this.addEventListener("aimg:reload-request", this)
  }

  disconnectedCallback(): void {
    this.removeEventListener("aimg:reload-request", this)
  }

  handleEvent(e: Event): void {
    // リロードを止めたいかどうか各要素に聞いて回る
    if (this.#askWorkersIfItShouldStopReload()) {
      console.info("阻止")
      e.stopPropagation()
      e.preventDefault()
    }
  }

  #askWorkersIfItShouldStopReload(): boolean {
    const news = new CustomEvent("aimg:reloading", {
      cancelable: true,
      detail: this,
    }) satisfies GlobalEventHandlersEventMap["aimg:reloading"]
    for (const worker of this.#workers) {
      worker.dispatchEvent(news)
    }
    return news.defaultPrevented
  }
}
