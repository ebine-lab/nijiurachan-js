import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { BouyomiConnectorElement } from "#js/elements/bouyomi-connector"

const INIT_COOLDOWN_MS = 3000
const TAG = "bouyomi-connector-test"

// jsdom は Web Speech API を実装しないため、最小限のモックを用意する。
type MockUtterance = {
  text: string
  lang: string
  rate: number
  volume: number
  onend: (() => void) | null
  onerror: (() => void) | null
}

let spokenUtterances: MockUtterance[] = []
let speakSpy: ReturnType<typeof vi.fn>
let cancelSpy: ReturnType<typeof vi.fn>
let fetchSpy: ReturnType<typeof vi.fn>

// jsdom (このvitest設定) は localStorage を提供しないため、メモリ実装を入れる。
function installLocalStorageMock(): void {
  const store = new Map<string, string>()
  const ls = {
    getItem: (k: string): string | null =>
      store.has(k) ? (store.get(k) ?? null) : null,
    setItem: (k: string, v: string): void => {
      store.set(k, String(v))
    },
    removeItem: (k: string): void => {
      store.delete(k)
    },
    clear: (): void => {
      store.clear()
    },
    key: (i: number): string | null => [...store.keys()][i] ?? null,
    get length(): number {
      return store.size
    },
  }
  vi.stubGlobal("localStorage", ls)
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: ls,
  })
}

function installSpeechMocks(): void {
  class MockSpeechSynthesisUtterance {
    text: string
    lang = ""
    rate = 1
    volume = 1
    onend: (() => void) | null = null
    onerror: (() => void) | null = null
    constructor(text: string) {
      this.text = text
    }
  }
  speakSpy = vi.fn((u: MockUtterance) => {
    spokenUtterances.push(u)
  })
  cancelSpy = vi.fn()
  vi.stubGlobal("SpeechSynthesisUtterance", MockSpeechSynthesisUtterance)
  vi.stubGlobal("speechSynthesis", { speak: speakSpy, cancel: cancelSpy })
  // window.speechSynthesis 経由のアクセスにも対応させる
  Object.defineProperty(window, "speechSynthesis", {
    configurable: true,
    value: { speak: speakSpy, cancel: cancelSpy },
  })
}

// jsdom の MutationObserver はマイクロタスクで発火するため、await で吐き出す。
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

function addReply(replyId: string, text: string): void {
  const container = document.querySelector("[data-thread-replies]")
  if (!container) throw new Error("replies container missing")
  const table = document.createElement("table")
  table.setAttribute("data-reply-id", replyId)
  const bq = document.createElement("blockquote")
  bq.textContent = text
  table.appendChild(bq)
  container.appendChild(table)
}

function firstUtterance(): MockUtterance {
  const u = spokenUtterances[0]
  if (!u) throw new Error("no utterance spoken")
  return u
}

async function mountInitialized(
  settings: Record<string, unknown>,
): Promise<HTMLElement> {
  localStorage.setItem("bouyomiSettings", JSON.stringify(settings))
  document.body.innerHTML = `<div data-thread-replies></div>`
  const el = document.createElement(TAG)
  el.setAttribute("data-thread-id", "t1")
  document.body.appendChild(el)
  // 初期ロードのクールタイムを消化して読み上げを有効化
  vi.advanceTimersByTime(INIT_COOLDOWN_MS)
  await flushMicrotasks()
  return el
}

describe("bouyomi-connector 読み上げ方式", () => {
  if (!customElements.get(TAG)) {
    customElements.define(TAG, BouyomiConnectorElement)
  }

  beforeEach(() => {
    vi.useFakeTimers()
    spokenUtterances = []
    installLocalStorageMock()
    installSpeechMocks()
    fetchSpy = vi.fn(() => Promise.resolve(new Response()))
    vi.stubGlobal("fetch", fetchSpy)
  })

  afterEach(() => {
    document.body.innerHTML = ""
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  test("mode=browser のとき Web Speech API で読み上げる", async () => {
    await mountInitialized({
      alwaysEnabled: true,
      mode: "browser",
      rate: 1.2,
      volume: 0.8,
    })

    addReply("r1", "こんにちは")
    await flushMicrotasks()

    expect(speakSpy).toHaveBeenCalledTimes(1)
    const u = firstUtterance()
    expect(u.text).toBe("こんにちは")
    expect(u.lang).toBe("ja-JP")
    expect(u.rate).toBe(1.2)
    expect(u.volume).toBe(0.8)
    // ブラウザ読み上げでは棒読みちゃんHTTPは叩かない
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test("mode=bouyomi のとき棒読みちゃんHTTPに送信し speak は呼ばない", async () => {
    await mountInitialized({
      alwaysEnabled: true,
      mode: "bouyomi",
    })

    addReply("r1", "テスト")
    await flushMicrotasks()

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const calledUrl = String(fetchSpy.mock.calls[0]?.[0] ?? "")
    expect(calledUrl).toContain("localhost:50080/Talk")
    expect(calledUrl).toContain(encodeURIComponent("テスト"))
    expect(speakSpy).not.toHaveBeenCalled()
  })

  test("port 設定を指定すると送信先ポートに反映される", async () => {
    await mountInitialized({
      alwaysEnabled: true,
      mode: "bouyomi",
      port: 50123,
    })

    addReply("r1", "ポート指定")
    await flushMicrotasks()

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const calledUrl = String(fetchSpy.mock.calls[0]?.[0] ?? "")
    expect(calledUrl).toContain("localhost:50123/Talk")
  })

  test("旧設定の endpoint からポート番号を引き継ぐ(後方互換)", async () => {
    await mountInitialized({
      alwaysEnabled: true,
      mode: "bouyomi",
      endpoint: "http://localhost:51000/Talk",
    })

    addReply("r1", "旧設定")
    await flushMicrotasks()

    const calledUrl = String(fetchSpy.mock.calls[0]?.[0] ?? "")
    expect(calledUrl).toContain("localhost:51000/Talk")
  })

  test("無効な port 設定はデフォルトポートにフォールバックする", async () => {
    await mountInitialized({
      alwaysEnabled: true,
      mode: "bouyomi",
      port: 99999,
    })

    addReply("r1", "無効ポート")
    await flushMicrotasks()

    const calledUrl = String(fetchSpy.mock.calls[0]?.[0] ?? "")
    expect(calledUrl).toContain("localhost:50080/Talk")
  })

  test("ポート番号入力を変更すると送信先と保存値に反映される", async () => {
    await mountInitialized({
      alwaysEnabled: true,
      mode: "bouyomi",
    })

    const input = document.querySelector<HTMLInputElement>(
      "[data-bouyomi-port]",
    )
    if (!input) throw new Error("port input missing")
    expect(input.value).toBe("50080")

    input.value = "50500"
    input.dispatchEvent(new Event("change"))

    addReply("r1", "変更後")
    await flushMicrotasks()

    const calledUrl = String(fetchSpy.mock.calls[0]?.[0] ?? "")
    expect(calledUrl).toContain("localhost:50500/Talk")

    const saved = JSON.parse(
      localStorage.getItem("bouyomiSettings") ?? "{}",
    ) as { port?: number }
    expect(saved.port).toBe(50500)
  })

  test("mode 未指定の既存設定は bouyomi として扱う(後方互換)", async () => {
    await mountInitialized({
      alwaysEnabled: true,
    })

    addReply("r1", "互換")
    await flushMicrotasks()

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(speakSpy).not.toHaveBeenCalled()
  })

  test("browser モードで rate/volume が範囲外でもクランプされる", async () => {
    await mountInitialized({
      alwaysEnabled: true,
      mode: "browser",
      rate: 99,
      volume: 5,
    })

    addReply("r1", "クランプ")
    await flushMicrotasks()

    const u = firstUtterance()
    // 上限超過は上限値ちょうどに丸められる（RATE_MAX=2 / 音量上限=1）
    expect(u.rate).toBe(2)
    expect(u.volume).toBe(1)
  })

  test("パネルは下端固定・右端から32pxに配置される", async () => {
    await mountInitialized({ alwaysEnabled: true, mode: "bouyomi" })

    const panel = document.querySelector<HTMLElement>(".bouyomi-fixed")
    if (!panel) throw new Error("panel missing")

    expect(panel.style.position).toBe("fixed")
    expect(panel.style.bottom).toMatch(/^0(px)?$/)
    expect(panel.style.right).toBe("32px")
    // content が tab の前（上側）にあり、開いたとき上に展開される
    expect(panel.firstElementChild?.className).toBe("bouyomi-content")
    expect(panel.lastElementChild?.className).toBe("bouyomi-tab")
  })

  test("タブクリックで開閉し、閉時は設定コンテンツを隠す", async () => {
    await mountInitialized({ alwaysEnabled: true, mode: "bouyomi" })

    const panel = document.querySelector<HTMLElement>(".bouyomi-fixed")
    const tab = document.querySelector<HTMLElement>(".bouyomi-tab")
    const content = document.querySelector<HTMLElement>(".bouyomi-content")
    if (!panel || !tab || !content) throw new Error("panel parts missing")

    expect(panel.classList.contains("collapsed")).toBe(true)
    expect(content.style.display).toBe("none")

    tab.click()
    expect(panel.classList.contains("collapsed")).toBe(false)
    expect(content.style.display).toBe("block")

    tab.click()
    expect(panel.classList.contains("collapsed")).toBe(true)
    expect(content.style.display).toBe("none")
  })

  test("タブをドラッグするとパネルが左右に移動し、直後のクリックでは開閉しない", async () => {
    await mountInitialized({ alwaysEnabled: true, mode: "bouyomi" })

    const panel = document.querySelector<HTMLElement>(".bouyomi-fixed")
    const tab = document.querySelector<HTMLElement>(".bouyomi-tab")
    if (!panel || !tab) throw new Error("panel parts missing")

    // jsdom では getBoundingClientRect().left = 0 のため、+120px の移動になる
    tab.dispatchEvent(
      new MouseEvent("pointerdown", { clientX: 500, bubbles: true }),
    )
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 620 }))
    window.dispatchEvent(new MouseEvent("pointerup"))

    expect(panel.style.left).toBe("120px")
    expect(panel.style.right).toBe("auto")

    // ドラッグ直後のクリックは開閉しない
    tab.click()
    expect(panel.classList.contains("collapsed")).toBe(true)

    // 次のクリックからは通常どおり開閉する
    tab.click()
    expect(panel.classList.contains("collapsed")).toBe(false)
  })

  test("しきい値未満の移動はクリック扱いになりパネルは動かない", async () => {
    await mountInitialized({ alwaysEnabled: true, mode: "bouyomi" })

    const panel = document.querySelector<HTMLElement>(".bouyomi-fixed")
    const tab = document.querySelector<HTMLElement>(".bouyomi-tab")
    if (!panel || !tab) throw new Error("panel parts missing")

    tab.dispatchEvent(
      new MouseEvent("pointerdown", { clientX: 500, bubbles: true }),
    )
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 502 }))
    window.dispatchEvent(new MouseEvent("pointerup"))

    // 初期位置（right:32px）から動いていない
    expect(panel.style.left).toBe("auto")
    expect(panel.style.right).toBe("32px")

    // クリック扱いなので開閉は動く
    tab.click()
    expect(panel.classList.contains("collapsed")).toBe(false)
  })

  test("disconnect 時に進行中の読み上げを cancel する", async () => {
    const el = await mountInitialized({
      alwaysEnabled: true,
      mode: "browser",
    })

    addReply("r1", "中断")
    await flushMicrotasks()
    el.remove()

    expect(cancelSpy).toHaveBeenCalled()
  })

  test("方式切替時に進行中の読み上げを cancel する", async () => {
    await mountInitialized({
      alwaysEnabled: true,
      mode: "browser",
    })

    const select = document.querySelector<HTMLSelectElement>(
      "[data-bouyomi-mode]",
    )
    if (!select) throw new Error("mode select missing")

    // 切替操作そのものによる cancel だけを測る
    cancelSpy.mockClear()
    select.value = "bouyomi"
    select.dispatchEvent(new Event("change"))

    expect(cancelSpy).toHaveBeenCalled()
  })
})
