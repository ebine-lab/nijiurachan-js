/** ホイールリロード（上端/下端でさらにスクロールでリロード） */
export class WheelReloadHandlerElement extends HTMLElement {
  #handler = new WheelReload(this)

  /** この要素をHTMLで使えるよう登録 */
  static define(): void {
    customElements.define("wheel-reload-handler", WheelReloadHandlerElement)
  }

  connectedCallback(): void {
    addEventListener("wheel", this.#handler, { passive: true })
  }

  disconnectedCallback(): void {
    removeEventListener("wheel", this.#handler)
  }
}

class WheelReload {
  #lastWheelTime = 0
  #wheelCount = 0 // ホイール回数をカウント
  #requiredCount = 3 // 3回で発動
  #cooldown = 1000 // リロード後のクールダウン（ms）
  #lastReloadTime = 0
  #lastDirection = 0 // 1=下, -1=上
  #indicatorBottom!: HTMLDivElement
  #indicatorTop!: HTMLDivElement

  constructor(readonly host: HTMLElement) {}

  #prepareIndicator(): void {
    if (this.#indicatorTop?.isConnected && this.#indicatorBottom?.isConnected) {
      return
    }

    // 下用インジケーター
    const indicatorBottom = document.createElement("div")
    indicatorBottom.id = "wheel-reload-indicator-bottom"
    indicatorBottom.innerHTML = "🔄 リロード中..."
    indicatorBottom.style.cssText = `
                position: fixed;
                bottom: 20px;
                left: 50%;
                transform: translateX(-50%) translateY(100px);
                background: rgba(0, 0, 0, 0.8);
                color: #fff;
                padding: 10px 20px;
                border-radius: 20px;
                font-size: 14px;
                z-index: 10000;
                transition: transform 0.3s ease;
                pointer-events: none;
            `
    this.host.appendChild(indicatorBottom)
    this.#indicatorBottom = indicatorBottom

    // 上用インジケーター
    const indicatorTop = document.createElement("div")
    indicatorTop.id = "wheel-reload-indicator-top"
    indicatorTop.innerHTML = "🔄 リロード中..."
    indicatorTop.style.cssText = `
                position: fixed;
                top: 20px;
                left: 50%;
                transform: translateX(-50%) translateY(-100px);
                background: rgba(0, 0, 0, 0.8);
                color: #fff;
                padding: 10px 20px;
                border-radius: 20px;
                font-size: 14px;
                z-index: 10000;
                transition: transform 0.3s ease;
                pointer-events: none;
            `
    this.host.appendChild(indicatorTop)
    this.#indicatorTop = indicatorTop
  }

  #showIndicator(direction: number): void {
    this.#prepareIndicator()

    // direction: -1=上, 1=下
    if (direction === -1 && this.#indicatorTop) {
      this.#indicatorTop.style.transform = "translateX(-50%) translateY(0)"
      setTimeout(() => {
        if (this.#indicatorTop) {
          this.#indicatorTop.style.transform =
            "translateX(-50%) translateY(-100px)"
        }
      }, 800)
    } else if (direction === 1 && this.#indicatorBottom) {
      this.#indicatorBottom.style.transform = "translateX(-50%) translateY(0)"
      setTimeout(() => {
        if (this.#indicatorBottom) {
          this.#indicatorBottom.style.transform =
            "translateX(-50%) translateY(100px)"
        }
      }, 800)
    }
  }

  handleEvent(e: WheelEvent): void {
    if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) {
      return
    }
    const direction = e.deltaY > 0 ? 1 : -1 // 1=下, -1=上

    // ページの上端/下端にいるかチェック
    const scrollTop = window.scrollY
    const scrollBottom = window.innerHeight + window.scrollY
    const docHeight = document.documentElement.scrollHeight
    const atTop = scrollTop <= 5
    const atBottom = scrollBottom >= docHeight - 5

    // 上スクロールで上端、または下スクロールで下端の場合のみ
    const validPosition =
      (direction === -1 && atTop) || (direction === 1 && atBottom)

    if (!validPosition) {
      this.#wheelCount = 0
      this.#lastDirection = 0
      return
    }

    // 方向が変わったらリセット
    if (this.#lastDirection !== 0 && this.#lastDirection !== direction) {
      this.#wheelCount = 0
    }
    this.#lastDirection = direction

    // クールダウン中はスキップ
    const now = Date.now()
    if (now - this.#lastReloadTime < this.#cooldown) {
      return
    }

    // 連続スクロールの判定（500ms以内）
    if (now - this.#lastWheelTime > 500) {
      this.#wheelCount = 0
    }
    this.#lastWheelTime = now

    // ホイール回数をカウント（1イベント = 1回）
    // 3回以上で発動
    this.#wheelCount++
    if (this.#wheelCount < this.#requiredCount) {
      return
    }

    this.#wheelCount = 0
    this.#lastReloadTime = now

    const req = new CustomEvent("aimg:reload-request", {
      bubbles: true,
      cancelable: true,
    })
    this.host.dispatchEvent(req)
    if (req.defaultPrevented) {
      console.info("阻\nざ")
      return
    }
    this.#showIndicator(direction)
  }
}
