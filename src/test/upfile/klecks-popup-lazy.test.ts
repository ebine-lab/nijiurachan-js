import { JSDOM } from "jsdom"
import { afterEach, describe, expect, vi as jest, test } from "vitest"
import type {} from "#js/components/types"
import { KlecksPopup } from "#js/io/klecks-popup"

/**
 * Klecks 本体 (klecks-*.js チャンクと embed.js) は「絵を描く」を押した瞬間まで
 * フェッチされないのが要件。以下の遅延ロード契約を守る:
 *   1. `new KlecksPopup(...)` はコンストラクタで URL を保持するだけで
 *      `window.open` や `fetch` を呼ばない
 *   2. `.popup()` を呼んで初めて `window.open("about:blank")` される
 *   3. 開いたポップアップの `<head>` に `<script type="module" src=popupUrl>` が
 *      注入され、そこで初めてチャンクがフェッチされる
 *   4. 注入された `<klecks-paint-host>` の `data-embed-src` が embedUrl と一致し、
 *      embed 本体は `connectedCallback` で初めてフェッチされる
 */
describe("KlecksPopup 遅延ロード契約", () => {
  const openSpies: Array<ReturnType<typeof jest.spyOn>> = []
  const alertSpies: Array<ReturnType<typeof jest.spyOn>> = []
  const fetchSpies: Array<ReturnType<typeof jest.spyOn>> = []

  afterEach(() => {
    for (const s of openSpies.splice(0)) s.mockRestore()
    for (const s of alertSpies.splice(0)) s.mockRestore()
    for (const s of fetchSpies.splice(0)) s.mockRestore()
  })

  test("コンストラクタは window.open も fetch も呼ばない", () => {
    const openSpy = jest.spyOn(window, "open").mockReturnValue(null)
    const alertSpy = jest.spyOn(window, "alert").mockReturnValue(undefined)
    const fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response())
    openSpies.push(openSpy)
    alertSpies.push(alertSpy)
    fetchSpies.push(fetchSpy)

    const popup = new KlecksPopup("host.js", "embed.js")

    expect(openSpy).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
    // 保持されている URL は後段テスト用に確認しておく
    expect(popup.src).toBe("host.js")
    expect(popup.embedSrc).toBe("embed.js")
  })

  test(".popup() で初めて window.open が呼ばれ、type=module の <script src=popupUrl> と data-embed-src=embedUrl の <klecks-paint-host> が注入される", () => {
    const dom = new JSDOM()
    const openSpy = jest
      .spyOn(window, "open")
      .mockReturnValue(dom.window as unknown as Window)
    const alertSpy = jest.spyOn(window, "alert").mockReturnValue(undefined)
    const fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response())
    openSpies.push(openSpy)
    alertSpies.push(alertSpy)
    fetchSpies.push(fetchSpy)

    const popup = new KlecksPopup("host.js", "embed.js")
    expect(openSpy).not.toHaveBeenCalled()

    const popupPromise = popup.popup({ canvasWidth: 100, canvasHeight: 200 })
    void popupPromise.catch(() => undefined)

    expect(openSpy).toHaveBeenCalledOnce()
    expect(openSpy).toHaveBeenCalledWith("about:blank")

    const script = dom.window.document.querySelector("script")
    expect(script).not.toBeNull()
    expect(script?.getAttribute("src")).toBe("host.js")
    expect(script?.getAttribute("type")).toBe("module")

    const host = dom.window.document.querySelector("klecks-paint-host")
    expect(host).not.toBeNull()
    expect(host?.getAttribute("data-embed-src")).toBe("embed.js")
    expect(host?.getAttribute("data-width")).toBe("100")
    expect(host?.getAttribute("data-height")).toBe("200")

    // popup() 自体は import/fetch を発生させない (script 注入によって
    // ブラウザが引き起こすフェッチはここではモックの範囲外)
    expect(fetchSpy).not.toHaveBeenCalled()

    popup.abort()
  })
})
