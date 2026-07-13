/**
// @file あいもげ棒読みちゃん連携を取り込んで改良したもの
// @description  aimgの新着レスをHTTP連携で棒読みちゃんに転送
// @author       yofumin
// @license      MIT
*/

/** 読み上げ方式 */
type SpeechMode = "bouyomi" | "browser"

/**
 * 棒読みちゃん連携設定
 */
interface BouyomiSettings {
  /** 常にON（全スレッド） */
  alwaysEnabled: boolean
  /** 新着時自動スクロール */
  autoScroll: boolean
  /** 棒読みちゃんHTTP連携のポート番号 */
  port: number
  /** 個別ONにしたスレッドID一覧 */
  enabledThreadIds: string[]
  /** 読み上げ方式（bouyomi=棒読みちゃん連携 / browser=ブラウザ内蔵） */
  mode: SpeechMode
  /** ブラウザ内蔵読み上げの速度（RATE_MIN〜RATE_MAX） */
  rate: number
  /** ブラウザ内蔵読み上げの音量（0〜1） */
  volume: number
}

const STORAGE_KEY = "bouyomiSettings"
const DEFAULT_PORT = 50080
const PORT_MIN = 1
const PORT_MAX = 65535
const INIT_COOLDOWN_MS = 3000
const QUEUE_INTERVAL_MS = 500
const MAX_TEXT_LENGTH = 200

/** パネル初期位置の右端からの距離（px） */
const PANEL_RIGHT_MARGIN_PX = 32
/** パネルの横幅 */
const PANEL_WIDTH_PX = 240
/** 非展開時（タブのみ）の縦幅 */
const TAB_HEIGHT_PX = 32
/** 開閉アニメーションの時間（ms） */
const PANEL_ANIM_MS = 250
/** 展開時コンテンツの最大高さ（下から迫り上がるアニメーションの上限） */
const DRAWER_MAX_HEIGHT_PX = 480
/** これ未満の移動はドラッグではなくクリックとして扱う（px） */
const DRAG_THRESHOLD_PX = 4
/** 開閉タブの矢印（上に展開するので閉時は上向き） */
const ARROW_COLLAPSED = "▲"
const ARROW_EXPANDED = "▼"

/** ブラウザ内蔵読み上げの言語 */
const SPEECH_LANG = "ja-JP"
const DEFAULT_RATE = 1
const DEFAULT_VOLUME = 1
const RATE_MIN = 0.5
const RATE_MAX = 2
/** onend が来ない環境向けフォールバックの1文字あたり見積もり時間 */
const SPEECH_MS_PER_CHAR = 200
/** 同上、見積もりに足す余裕（ms） */
const SPEECH_SAFETY_MARGIN_MS = 2000

/**
 * 棒読みちゃん連携カスタム要素
 * 新着レスを検出して棒読みちゃんに送信する
 */
export class BouyomiConnectorElement extends HTMLElement {
  /** MutationObserver */
  #observer: MutationObserver | null = null

  /** 読み上げキュー */
  #queue: string[] = []

  /** キュー処理中フラグ */
  #isProcessing = false

  /** 初期化完了フラグ（クールタイム後にtrue） */
  #isInitialized = false

  /** 処理済みレスID（重複読み上げ防止） */
  #processedReplyIds: Set<string> = new Set()

  /** 設定 */
  #settings: BouyomiSettings = {
    alwaysEnabled: false,
    autoScroll: false,
    port: DEFAULT_PORT,
    enabledThreadIds: [],
    mode: "bouyomi",
    rate: DEFAULT_RATE,
    volume: DEFAULT_VOLUME,
  }

  /** UIパネル要素 */
  #panel: HTMLElement | null = null

  /** ドラッグ中の状態（null なら非ドラッグ） */
  #drag: { startX: number; startLeft: number; moved: boolean } | null = null

  /** ドラッグ直後のクリックで開閉しないようにするフラグ */
  #suppressNextClick = false

  /** クールダウンタイマーID */
  #cooldownTimer: ReturnType<typeof setTimeout> | null = null

  /** キュー処理タイマーID */
  #queueTimer: ReturnType<typeof setTimeout> | null = null

  /** この要素を登録 */
  static define(): void {
    customElements.define("bouyomi-connector", BouyomiConnectorElement)
  }

  /** 現在のスレッドID */
  get #threadId(): string {
    return this.getAttribute("data-thread-id") || ""
  }

  /** 読み上げが有効かどうか */
  get #isEnabled(): boolean {
    return (
      this.#settings.alwaysEnabled ||
      this.#settings.enabledThreadIds.includes(this.#threadId)
    )
  }

  connectedCallback(): void {
    this.#loadSettings()
    this.#createPanel()

    // 既存レスのIDを収集（読み上げ対象から除外するため）
    this.#collectExistingReplyIds()

    this.#startObserver()

    // 初期ロードクールタイム（既存レスの読み上げ防止）
    this.#cooldownTimer = setTimeout(() => {
      this.#isInitialized = true
      this.#cooldownTimer = null
    }, INIT_COOLDOWN_MS)
  }

  disconnectedCallback(): void {
    this.#stopObserver()
    this.#handleDragEnd()
    this.#suppressNextClick = false
    this.#panel?.remove()

    // タイマーをクリア
    if (this.#cooldownTimer !== null) {
      clearTimeout(this.#cooldownTimer)
      this.#cooldownTimer = null
    }
    if (this.#queueTimer !== null) {
      clearTimeout(this.#queueTimer)
      this.#queueTimer = null
    }
    // 進行中・予約済みのブラウザ読み上げを止める
    this.#cancelSpeech()
    this.#queue = []
    this.#isInitialized = false
    this.#isProcessing = false
  }

  /** 設定をlocalStorageから読み込み */
  #loadSettings(): void {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        // 旧設定は port の代わりに endpoint(URL文字列) を持つ
        const parsed = JSON.parse(saved) as Partial<BouyomiSettings> & {
          endpoint?: string
        }
        this.#settings = {
          alwaysEnabled: parsed.alwaysEnabled ?? false,
          autoScroll: parsed.autoScroll ?? false,
          port:
            this.#normalizePort(parsed.port) ??
            this.#portFromEndpoint(parsed.endpoint) ??
            DEFAULT_PORT,
          enabledThreadIds: parsed.enabledThreadIds ?? [],
          // 旧設定（mode 無し）は棒読みちゃん連携として扱う
          mode: parsed.mode === "browser" ? "browser" : "bouyomi",
          rate: typeof parsed.rate === "number" ? parsed.rate : DEFAULT_RATE,
          volume:
            typeof parsed.volume === "number" ? parsed.volume : DEFAULT_VOLUME,
        }
      }
    } catch {
      // パースエラー時はデフォルト値を使用
    }
  }

  /** 設定をlocalStorageに保存 */
  #saveSettings(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.#settings))
    } catch {
      // プライベートモードやストレージ容量超過時は無視
    }
  }

  /** 既存レスのIDを収集 */
  #collectExistingReplyIds(): void {
    const repliesContainer = document.querySelector("[data-thread-replies]")
    if (!repliesContainer) return

    repliesContainer.querySelectorAll("table[data-reply-id]").forEach((el) => {
      const replyId = el.getAttribute("data-reply-id")
      if (replyId) {
        this.#processedReplyIds.add(replyId)
      }
    })
  }

  /** MutationObserverを開始 */
  #startObserver(): void {
    const repliesContainer = document.querySelector("[data-thread-replies]")
    if (!repliesContainer) return

    this.#observer = new MutationObserver((mutations) => {
      this.#handleMutations(mutations)
    })

    this.#observer.observe(repliesContainer, {
      childList: true,
      subtree: true,
    })
  }

  /** MutationObserverを停止 */
  #stopObserver(): void {
    this.#observer?.disconnect()
    this.#observer = null
  }

  /** Mutation処理 */
  #handleMutations(mutations: MutationRecord[]): void {
    if (!this.#isInitialized) return

    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue

        const element = node as Element

        // 新着レス（table[data-reply-id]）を検出
        // addedNodesには直接挿入されたノードのみ含まれるため、
        // 自身のチェックに加え子孫も検索する
        const targets = element.matches("table[data-reply-id]")
          ? [element]
          : Array.from(element.querySelectorAll("table[data-reply-id]"))

        for (const target of targets) {
          const replyId = target.getAttribute("data-reply-id")
          if (replyId && !this.#processedReplyIds.has(replyId)) {
            this.#processedReplyIds.add(replyId)
            this.#processNewReply(target)
          }
        }
      }
    }
  }

  /** 新着レス処理 */
  #processNewReply(replyElement: Element): void {
    // 自動スクロール
    if (this.#settings.autoScroll) {
      this.#scrollToBottom()
    }

    // 読み上げが無効なら終了
    if (!this.#isEnabled) return

    // テキスト抽出
    const text = this.#extractTextFromReply(replyElement)
    if (text) {
      this.#enqueue(text)
    }
  }

  /** レスからテキストを抽出 */
  #extractTextFromReply(replyElement: Element): string {
    const blockquote = replyElement.querySelector("blockquote")
    if (!blockquote) return ""

    // クローンしてURL要素を除去
    const clone = blockquote.cloneNode(true) as Element

    // URL含むリンクを除去
    clone.querySelectorAll("a").forEach((a) => {
      const href = a.getAttribute("href") || ""
      const text = a.textContent || ""
      // URLっぽいテキストを含むリンクを除去
      if (
        href.startsWith("http") ||
        text.startsWith("http") ||
        text.includes("://")
      ) {
        a.remove()
      }
    })

    // テキスト取得・整形
    let text = clone.textContent || ""
    text = text.replace(/https?:\/\/\S+/g, "") // 残りのURLを除去
    text = text.replace(/\s+/g, " ").trim() // 空白正規化

    // 200文字制限
    if (text.length > MAX_TEXT_LENGTH) {
      text = `${text.slice(0, MAX_TEXT_LENGTH)}...`
    }

    return text
  }

  /** キューに追加 */
  #enqueue(text: string): void {
    this.#queue.push(text)
    this.#processQueue()
  }

  /** キュー処理 */
  #processQueue(): void {
    if (this.#isProcessing || this.#queue.length === 0) return

    this.#isProcessing = true
    const text = this.#queue.shift()

    if (text) {
      this.#speak(text, () => this.#advanceQueue())
    } else {
      this.#advanceQueue()
    }
  }

  /** 1件の読み上げ完了後に次のキューへ進む */
  #advanceQueue(): void {
    this.#isProcessing = false
    this.#processQueue()
  }

  /** 現在の方式で1件読み上げ、次へ進める準備ができたら done を呼ぶ */
  #speak(text: string, done: () => void): void {
    if (this.#settings.mode === "browser") {
      this.#speakWithBrowser(text, done)
      return
    }

    this.#sendToBouyomi(text)
    // 棒読みちゃんは送信のみで完了を取得できないため固定間隔で次へ
    this.#queueTimer = setTimeout(() => {
      this.#queueTimer = null
      done()
    }, QUEUE_INTERVAL_MS)
  }

  /** ポート番号として有効なら整数化して返す。無効なら null */
  #normalizePort(value: unknown): number | null {
    if (typeof value !== "number" || !Number.isFinite(value)) return null
    const port = Math.trunc(value)
    if (port < PORT_MIN || port > PORT_MAX) return null
    return port
  }

  /** 旧設定の endpoint(URL文字列) からポート番号を取り出す（後方互換） */
  #portFromEndpoint(endpoint: string | undefined): number | null {
    if (!endpoint) return null
    try {
      const url = new URL(endpoint)
      return url.port ? this.#normalizePort(Number(url.port)) : null
    } catch {
      return null
    }
  }

  /** 棒読みちゃんに送信 */
  #sendToBouyomi(text: string): void {
    const endpoint = `http://localhost:${this.#settings.port}/Talk`
    const url = `${endpoint}?text=${encodeURIComponent(text)}`

    // no-corsモードで送信（レスポンスは取得不可だが送信は成功）
    fetch(url, { mode: "no-cors" }).catch(() => {
      // フォールバック: Image経由で送信
      const img = new Image()
      img.src = url
    })
  }

  /** ブラウザ内蔵の音声合成（Web Speech API）で読み上げ */
  #speakWithBrowser(text: string, done: () => void): void {
    const synth = window.speechSynthesis
    if (!synth || typeof SpeechSynthesisUtterance === "undefined") {
      // 非対応環境では固定間隔で次へ送り、停止しないようにする
      this.#queueTimer = setTimeout(() => {
        this.#queueTimer = null
        done()
      }, QUEUE_INTERVAL_MS)
      return
    }

    const rate = this.#clampRate(this.#settings.rate)
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = SPEECH_LANG
    utterance.rate = rate
    utterance.volume = this.#clampVolume(this.#settings.volume)

    // onend / onerror / セーフティタイマーのうち最初の1回だけ次へ進む
    let advanced = false
    const advance = (): void => {
      if (advanced) return
      advanced = true
      if (this.#queueTimer !== null) {
        clearTimeout(this.#queueTimer)
        this.#queueTimer = null
      }
      done()
    }
    utterance.onend = advance
    utterance.onerror = advance

    // onend が発火しない環境向けに、文字数と速度から見積もったタイムアウトで保険
    const estimatedMs =
      (text.length * SPEECH_MS_PER_CHAR) / rate + SPEECH_SAFETY_MARGIN_MS
    this.#queueTimer = setTimeout(advance, estimatedMs)

    synth.speak(utterance)
  }

  /** 進行中・予約済みのブラウザ読み上げを止める */
  #cancelSpeech(): void {
    try {
      window.speechSynthesis?.cancel()
    } catch {
      // 非対応環境は無視
    }
  }

  /** 読み上げ速度を許容範囲にクランプ */
  #clampRate(value: number): number {
    if (Number.isNaN(value)) return DEFAULT_RATE
    return Math.min(RATE_MAX, Math.max(RATE_MIN, value))
  }

  /** 読み上げ音量を 0〜1 にクランプ */
  #clampVolume(value: number): number {
    if (Number.isNaN(value)) return DEFAULT_VOLUME
    return Math.min(1, Math.max(0, value))
  }

  /** 最下部にスクロール */
  #scrollToBottom(): void {
    requestAnimationFrame(() => {
      window.scrollTo({
        top: document.documentElement.scrollHeight,
        behavior: "smooth",
      })
    })
  }

  /** このスレッドの読み上げをトグル */
  #toggleThreadEnabled(): void {
    const threadId = this.#threadId
    if (!threadId) return

    const idx = this.#settings.enabledThreadIds.indexOf(threadId)
    if (idx >= 0) {
      this.#settings.enabledThreadIds.splice(idx, 1)
    } else {
      this.#settings.enabledThreadIds.push(threadId)
    }
    this.#saveSettings()
    this.#updateToggleButton()
  }

  /** トグルボタンの表示を更新 */
  #updateToggleButton(): void {
    const btn = this.#panel?.querySelector<HTMLButtonElement>(
      "[data-bouyomi-thread-toggle]",
    )
    if (!btn) return

    const threadId = this.#threadId
    const isOn =
      this.#settings.alwaysEnabled ||
      this.#settings.enabledThreadIds.includes(threadId)
    btn.textContent = isOn
      ? "このスレで読み上げ：ON"
      : "このスレで読み上げ：OFF"
    btn.style.background = isOn ? "#4CAF50" : "#888"
  }

  /** DOM要素を作成するヘルパー */
  #el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    props?: Partial<Record<string, string>>,
    children?: (Node | string)[],
  ): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag)
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (k === "className") el.className = v ?? ""
        else if (k === "textContent") el.textContent = v ?? ""
        else if (v !== undefined) el.setAttribute(k, v)
      }
    }
    if (children) {
      for (const child of children) {
        if (typeof child === "string") {
          el.appendChild(document.createTextNode(child))
        } else {
          el.appendChild(child)
        }
      }
    }
    return el
  }

  /** UIパネル作成 */
  #createPanel(): void {
    // トグルボタン
    const toggleBtn = this.#el(
      "button",
      {
        type: "button",
        "data-bouyomi-thread-toggle": "",
        style:
          "width:100%;padding:6px 8px;border:none;border-radius:4px;color:#fff;cursor:pointer;font-size:12px;font-weight:bold",
      },
      ["このスレで読み上げ：OFF"],
    )

    // 常にONチェックボックス
    const alwaysCheckbox = this.#el("input", {
      type: "checkbox",
      "data-bouyomi-always": "",
      style: "width:14px;height:14px;cursor:pointer",
    })
    const alwaysLabel = this.#el(
      "label",
      {
        style:
          "display:flex;align-items:center;gap:6px;margin-top:6px;cursor:pointer;font-size:12px",
      },
      [alwaysCheckbox, "常にON"],
    )

    // 自動スクロールチェックボックス
    const autoScrollCheckbox = this.#el("input", {
      type: "checkbox",
      "data-bouyomi-autoscroll": "",
      style: "width:14px;height:14px;cursor:pointer",
    })
    const autoScrollLabel = this.#el(
      "label",
      {
        style:
          "display:flex;align-items:center;gap:6px;margin-top:4px;cursor:pointer;font-size:12px",
      },
      [autoScrollCheckbox, "自動スクロール"],
    )

    // 読み上げ方式セレクト（棒読みちゃん / ブラウザ内蔵）
    const modeSelect = this.#el(
      "select",
      {
        "data-bouyomi-mode": "",
        style: "width:100%;margin-top:4px;padding:4px;font-size:12px",
      },
      [
        this.#el("option", { value: "bouyomi" }, ["棒読みちゃん"]),
        this.#el("option", { value: "browser" }, [
          "ブラウザ内蔵（外部アプリ不要）",
        ]),
      ],
    )
    const modeLabel = this.#el(
      "label",
      { style: "display:block;margin-top:8px;font-size:12px" },
      ["読み上げ方法", modeSelect],
    )

    // 棒読みちゃんモードのポート番号入力
    const portInput = this.#el("input", {
      type: "number",
      min: String(PORT_MIN),
      max: String(PORT_MAX),
      "data-bouyomi-port": "",
      style:
        "width:100%;margin-top:2px;padding:4px;font-size:12px;box-sizing:border-box",
    })
    const portLabel = this.#el(
      "label",
      { style: "display:block;margin-top:6px;font-size:12px" },
      ["ポート番号", portInput],
    )

    // 棒読みちゃんモード専用設定（mode に応じて表示切替）
    const bouyomiSettings = this.#el(
      "div",
      { "data-bouyomi-http-settings": "", style: "margin-top:4px" },
      [portLabel],
    )

    // ブラウザ内蔵モードの速度スライダー
    const rateInput = this.#el("input", {
      type: "range",
      min: String(RATE_MIN),
      max: String(RATE_MAX),
      step: "0.1",
      "data-bouyomi-rate": "",
      style: "width:100%",
    })
    const rateValue = this.#el("span", { "data-bouyomi-rate-value": "" })
    const rateLabel = this.#el(
      "label",
      { style: "display:block;margin-top:6px;font-size:12px" },
      ["速度 ", rateValue, rateInput],
    )

    // ブラウザ内蔵モードの音量スライダー
    const volumeInput = this.#el("input", {
      type: "range",
      min: "0",
      max: "1",
      step: "0.1",
      "data-bouyomi-volume": "",
      style: "width:100%",
    })
    const volumeValue = this.#el("span", {
      "data-bouyomi-volume-value": "",
    })
    const volumeLabel = this.#el(
      "label",
      { style: "display:block;margin-top:6px;font-size:12px" },
      ["音量 ", volumeValue, volumeInput],
    )

    // ブラウザ内蔵モード専用設定（mode に応じて表示切替）
    const browserSettings = this.#el(
      "div",
      { "data-bouyomi-browser-settings": "", style: "margin-top:4px" },
      [rateLabel, volumeLabel],
    )

    // コントロール群
    const controls = this.#el("div", { className: "bouyomi-controls" }, [
      toggleBtn,
      alwaysLabel,
      autoScrollLabel,
      modeLabel,
      bouyomiSettings,
      browserSettings,
    ])

    // ヘッダー
    const header = this.#el("div", { className: "bouyomi-header" }, [
      "読み上げ設定",
    ])

    // パネル本体
    const body = this.#el("div", { className: "bouyomi-body" }, [
      header,
      controls,
    ])
    const content = this.#el(
      "div",
      {
        className: "bouyomi-content",
        style: "width:100%;box-sizing:border-box",
      },
      [body],
    )

    // 開閉アニメーション用の入れ物（閉じた状態で開始）
    // max-height を 0→上限 に遷移させ、下端アンカーなので下から迫り上がって見える
    const drawer = this.#el(
      "div",
      {
        "data-bouyomi-drawer": "",
        style: `overflow:hidden;max-height:0px;visibility:hidden;transition:max-height ${PANEL_ANIM_MS}ms ease,visibility ${PANEL_ANIM_MS}ms`,
      },
      [content],
    )

    // タブ（クリックで開閉、ドラッグで左右移動）
    const tabArrow = this.#el("span", { className: "tab-arrow" }, [
      ARROW_COLLAPSED,
    ])
    const tab = this.#el(
      "div",
      {
        className: "bouyomi-tab",
        style: `width:100%;height:${TAB_HEIGHT_PX}px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:4px;writing-mode:horizontal-tb;cursor:pointer;user-select:none;touch-action:none`,
      },
      [tabArrow, "読み上げ"],
    )

    // コンテナ（下端固定・右端から32px・展開時と同じ横幅。drawer→tab の順で上に展開する）
    this.#panel = this.#el(
      "div",
      {
        className: "bouyomi-fixed collapsed",
        style: `position:fixed;top:auto;bottom:0;left:auto;right:${PANEL_RIGHT_MARGIN_PX}px;width:${PANEL_WIDTH_PX}px;display:flex;flex-direction:column;z-index:9999`,
      },
      [drawer, tab],
    )

    // タブクリックで開閉（ドラッグ直後のクリックは無視）
    tab.addEventListener("click", () => {
      if (this.#suppressNextClick) {
        this.#suppressNextClick = false
        return
      }
      const collapsed = this.#panel?.classList.toggle("collapsed") ?? true
      drawer.style.maxHeight = collapsed ? "0px" : `${DRAWER_MAX_HEIGHT_PX}px`
      drawer.style.visibility = collapsed ? "hidden" : "visible"
      tabArrow.textContent = collapsed ? ARROW_COLLAPSED : ARROW_EXPANDED
    })

    // タブのドラッグで左右移動
    tab.addEventListener("pointerdown", (event) => {
      this.#startDrag(event)
    })

    // トグルボタン
    toggleBtn.addEventListener("click", () => {
      this.#toggleThreadEnabled()
    })

    // 常にONチェックボックス
    alwaysCheckbox.checked = this.#settings.alwaysEnabled
    alwaysCheckbox.addEventListener("change", () => {
      this.#settings.alwaysEnabled = alwaysCheckbox.checked
      this.#saveSettings()
      this.#updateToggleButton()
    })

    // 自動スクロールチェックボックス
    autoScrollCheckbox.checked = this.#settings.autoScroll
    autoScrollCheckbox.addEventListener("change", () => {
      this.#settings.autoScroll = autoScrollCheckbox.checked
      this.#saveSettings()
    })

    // 読み上げ方式セレクト
    modeSelect.value = this.#settings.mode
    modeSelect.addEventListener("change", () => {
      this.#settings.mode =
        modeSelect.value === "browser" ? "browser" : "bouyomi"
      this.#saveSettings()
      this.#updateModeSettingsVisibility()
      // 方式切替時は進行中の読み上げを止める
      this.#cancelSpeech()
    })

    // ポート番号入力（無効値はデフォルトに戻す）
    portInput.value = String(this.#settings.port)
    portInput.addEventListener("change", () => {
      const port = this.#normalizePort(Number(portInput.value)) ?? DEFAULT_PORT
      this.#settings.port = port
      portInput.value = String(port)
      this.#saveSettings()
    })

    // 速度スライダー
    rateInput.value = String(this.#settings.rate)
    rateValue.textContent = `${this.#settings.rate.toFixed(1)}x`
    rateInput.addEventListener("input", () => {
      const value = Number(rateInput.value)
      this.#settings.rate = value
      rateValue.textContent = `${value.toFixed(1)}x`
      this.#saveSettings()
    })

    // 音量スライダー
    volumeInput.value = String(this.#settings.volume)
    volumeValue.textContent = `${Math.round(this.#settings.volume * 100)}%`
    volumeInput.addEventListener("input", () => {
      const value = Number(volumeInput.value)
      this.#settings.volume = value
      volumeValue.textContent = `${Math.round(value * 100)}%`
      this.#saveSettings()
    })

    document.body.appendChild(this.#panel)

    // 初期状態の表示を更新
    this.#updateToggleButton()
    this.#updateModeSettingsVisibility()
  }

  /** モードに応じて各方式専用設定（ポート / 速度・音量）の表示を切り替える */
  #updateModeSettingsVisibility(): void {
    const isBrowser = this.#settings.mode === "browser"
    const browserBox = this.#panel?.querySelector<HTMLElement>(
      "[data-bouyomi-browser-settings]",
    )
    if (browserBox) {
      browserBox.style.display = isBrowser ? "block" : "none"
    }
    const bouyomiBox = this.#panel?.querySelector<HTMLElement>(
      "[data-bouyomi-http-settings]",
    )
    if (bouyomiBox) {
      bouyomiBox.style.display = isBrowser ? "none" : "block"
    }
  }

  /** タブのドラッグを開始 */
  #startDrag(event: PointerEvent): void {
    if (!this.#panel) return
    this.#drag = {
      startX: event.clientX,
      startLeft: this.#panel.getBoundingClientRect().left,
      moved: false,
    }
    window.addEventListener("pointermove", this.#handleDragMove)
    window.addEventListener("pointerup", this.#handleDragEnd)
  }

  /** ドラッグ中: パネルを左右に追従させる（上下は動かさない） */
  #handleDragMove = (event: PointerEvent): void => {
    const drag = this.#drag
    const panel = this.#panel
    if (!drag || !panel) return

    const dx = event.clientX - drag.startX
    // しきい値未満はクリック扱いのまま
    if (!drag.moved && Math.abs(dx) < DRAG_THRESHOLD_PX) return
    drag.moved = true

    const maxLeft = Math.max(0, window.innerWidth - panel.offsetWidth)
    const left = Math.min(maxLeft, Math.max(0, drag.startLeft + dx))
    panel.style.left = `${left}px`
    panel.style.right = "auto"
  }

  /** ドラッグ終了: 移動していたら直後のクリックによる開閉を抑止 */
  #handleDragEnd = (): void => {
    if (this.#drag?.moved) {
      this.#suppressNextClick = true
    }
    this.#drag = null
    window.removeEventListener("pointermove", this.#handleDragMove)
    window.removeEventListener("pointerup", this.#handleDragEnd)
  }
}
