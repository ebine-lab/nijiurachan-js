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
import { AxnosPaintPopup } from "#js/io/axnos-paint-popup"

describe(AxnosPaintPopup, () => {
  let openSpy: Mock<typeof window.open>
  let alertSpy: Mock<typeof window.alert>

  afterEach(() => {
    openSpy?.mockRestore()
    alertSpy?.mockRestore()
  })

  test("ポップアップからメッセージを受け取ったらそれを返すこと", async () => {
    const image = new Blob(["test image data"], { type: "image/webp" })
    const dom = new JSDOM()
    openSpy = jest
      .spyOn(window, "open")
      .mockReturnValue(dom.window as unknown as Window)
    alertSpy = jest.spyOn(window, "alert").mockReturnValue(undefined)

    const popup = new AxnosPaintPopup("hello")
    const popupPromise = popup.popup({
      canvasWidth: 123,
      canvasHeight: 456,
    })
    const popupId = dom.window.document.querySelector("[id]")?.id
    const e = new CustomEvent("aimg:painted", {
      detail: { image, popupId },
    }) as GlobalEventHandlersEventMap["aimg:painted"]
    window.dispatchEvent(e)

    await expect(popupPromise).resolves.toEqual(image)
    expect(e.detail.isAccepted).toBe(true)
  }, 1000)

  test("結果待ちを中断したときリジェクトすること", async () => {
    openSpy = jest
      .spyOn(window, "open")
      .mockReturnValue(new JSDOM().window as unknown as Window)
    alertSpy = jest.spyOn(window, "alert").mockReturnValue(undefined)

    const popup = new AxnosPaintPopup("hello")
    const popupPromise = popup.popup({
      canvasWidth: 123,
      canvasHeight: 456,
    })

    popup.abort()

    await expect(popupPromise).rejects.toBeDefined()
  }, 1000)

  test("ポップアップに失敗したときリジェクトすること", async () => {
    openSpy = jest.spyOn(window, "open").mockReturnValue(null)
    alertSpy = jest.spyOn(window, "alert").mockReturnValue(undefined)

    const popup = new AxnosPaintPopup("hello")
    const popupPromise = popup.popup({
      canvasWidth: 123,
      canvasHeight: 456,
    })

    await expect(popupPromise).rejects.toBeDefined()
  }, 1000)
})
