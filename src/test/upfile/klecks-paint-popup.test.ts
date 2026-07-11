import { JSDOM } from "jsdom"
import {
  afterEach,
  describe,
  expect,
  vi as jest,
  type Mock,
  test,
} from "vitest"
import type {} from "#js/components/types"
import { KlecksPopup } from "#js/io/klecks-popup"

describe(KlecksPopup, () => {
  let openSpy: Mock<typeof window.open>
  let alertSpy: Mock<typeof window.alert>

  afterEach(() => {
    openSpy?.mockRestore()
    alertSpy?.mockRestore()
  })

  test("ポップアップから画像を受け取ったらそれを返すこと", async () => {
    const image = new Blob(["test image data"], { type: "image/png" })
    const dom = new JSDOM()
    openSpy = jest
      .spyOn(window, "open")
      .mockReturnValue(dom.window as unknown as Window)
    alertSpy = jest.spyOn(window, "alert").mockReturnValue(undefined)

    const popup = new KlecksPopup("host.js", "embed.js")
    const popupPromise = popup.popup({
      canvasWidth: 123,
      canvasHeight: 456,
    })
    const host = dom.window.document.querySelector("klecks-paint-host")
    expect(host?.getAttribute("data-embed-src")).toBe("embed.js")
    expect(host?.getAttribute("data-width")).toBe("123")
    expect(host?.getAttribute("data-height")).toBe("456")

    const script = dom.window.document.querySelector("script")
    expect(script?.getAttribute("src")).toBe("host.js")

    const e = new CustomEvent("aimg:painted", {
      detail: { image, popupId: host?.id },
    }) as GlobalEventHandlersEventMap["aimg:painted"]
    window.dispatchEvent(e)

    await expect(popupPromise).resolves.toEqual(image)
    expect(e.detail.isAccepted).toBe(true)
  }, 1000)

  test("結果待ちを中断したときAbortErrorでリジェクトしポップアップを閉じること", async () => {
    const popupWindow = new JSDOM().window as unknown as Window
    const closeSpy = jest.spyOn(popupWindow, "close").mockReturnValue(undefined)
    openSpy = jest.spyOn(window, "open").mockReturnValue(popupWindow)
    alertSpy = jest.spyOn(window, "alert").mockReturnValue(undefined)

    const popup = new KlecksPopup("host.js", "embed.js")
    const popupPromise = popup.popup({
      canvasWidth: 123,
      canvasHeight: 456,
    })

    popup.abort()

    await expect(popupPromise).rejects.toMatchObject({
      name: "AbortError",
    })
    expect(closeSpy).toHaveBeenCalledOnce()
  }, 1000)

  test("開き直すと前のポップアップを閉じること", async () => {
    const firstWindow = new JSDOM().window as unknown as Window
    const secondWindow = new JSDOM().window as unknown as Window
    const firstCloseSpy = jest
      .spyOn(firstWindow, "close")
      .mockReturnValue(undefined)
    openSpy = jest
      .spyOn(window, "open")
      .mockReturnValueOnce(firstWindow)
      .mockReturnValueOnce(secondWindow)
    alertSpy = jest.spyOn(window, "alert").mockReturnValue(undefined)

    const popup = new KlecksPopup("host.js", "embed.js")
    const firstPromise = popup.popup({
      canvasWidth: 123,
      canvasHeight: 456,
    })
    void firstPromise.catch(() => undefined)

    void popup
      .popup({
        canvasWidth: 123,
        canvasHeight: 456,
      })
      .catch(() => undefined)

    expect(firstCloseSpy).toHaveBeenCalledOnce()
  }, 1000)

  test("ポップアップに失敗したときリジェクトすること", async () => {
    openSpy = jest.spyOn(window, "open").mockReturnValue(null)
    alertSpy = jest.spyOn(window, "alert").mockReturnValue(undefined)

    const popup = new KlecksPopup("host.js", "embed.js")
    const popupPromise = popup.popup({
      canvasWidth: 123,
      canvasHeight: 456,
    })

    await expect(popupPromise).rejects.toBeDefined()
  }, 1000)
})
