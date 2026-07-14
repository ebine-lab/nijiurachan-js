import { describe, expect, vi as jest, test } from "vitest"
import {
  isPaintPopupAvailable,
  type OekakiPaintPopupConfig,
  resolvePaintPopup,
  selectedPaintAction,
} from "#js/components/oekaki-paint-popup"
import type {
  IAxnosPaintPopup,
  IKlecksPaintPopup,
  OekakiTool,
} from "#js/components/types"

function fakePopup(): IAxnosPaintPopup & IKlecksPaintPopup {
  return {
    popup: jest.fn(),
    abort: jest.fn(),
  }
}

describe(resolvePaintPopup, () => {
  // fileTool は setImage() で MIME サフィックスとして使われ、バックエンドの
  // `is_oekaki` フラグ判定 (parseUpload の `image/{png,webp}+oekaki(98)` の
  // 4 種 match) を通すには必ず "oekaki" である必要がある。将来 "klecks" 等の
  // 独自 tool 名に戻すとお絵描きフラグが立たなくなるので、それをここで縛る。

  test("単体 config (IAxnosPaintPopup) を渡すと fileTool は 'oekaki'", () => {
    const axnos = fakePopup()
    const resolved = resolvePaintPopup(axnos, "axnos")
    expect(resolved.popup).toBe(axnos)
    expect(resolved.fileTool).toBe("oekaki")
  })

  test("axnos + klecks config で tool='axnos' なら axnos が選ばれ fileTool='oekaki'", () => {
    const axnos = fakePopup()
    const klecks = fakePopup()
    const config: OekakiPaintPopupConfig = {
      axnos,
      klecks,
      getOekakiTool: () => "axnos",
    }
    const resolved = resolvePaintPopup(config, "axnos")
    expect(resolved.popup).toBe(axnos)
    expect(resolved.fileTool).toBe("oekaki")
  })

  test("axnos + klecks config で tool='klecks' なら klecks が選ばれるが fileTool は 'oekaki'", () => {
    const axnos = fakePopup()
    const klecks = fakePopup()
    const config: OekakiPaintPopupConfig = {
      axnos,
      klecks,
      getOekakiTool: () => "klecks",
    }
    const resolved = resolvePaintPopup(config, "klecks")
    expect(resolved.popup).toBe(klecks)
    // ここが今回の修正のガード。以前は "klecks" を返しており、バックエンドで
    // is_oekaki=false となる不具合の原因になっていた。
    expect(resolved.fileTool).toBe("oekaki")
  })

  test("klecks 未設定の config で tool='klecks' を渡すと axnos に fallback し fileTool='oekaki'", () => {
    const axnos = fakePopup()
    const config: OekakiPaintPopupConfig = {
      axnos,
      getOekakiTool: () => "klecks",
    }
    const resolved = resolvePaintPopup(config, "klecks")
    expect(resolved.popup).toBe(axnos)
    expect(resolved.fileTool).toBe("oekaki")
  })
})

describe(selectedPaintAction, () => {
  test("単体 config なら 'paint-button-clicked'", () => {
    expect(selectedPaintAction(fakePopup())).toBe("paint-button-clicked")
  })

  test("klecks 設定済みで getOekakiTool='klecks' なら 'klecks-button-clicked'", () => {
    const config: OekakiPaintPopupConfig = {
      axnos: fakePopup(),
      klecks: fakePopup(),
      getOekakiTool: () => "klecks",
    }
    expect(selectedPaintAction(config)).toBe("klecks-button-clicked")
  })

  test("klecks 未設定なら getOekakiTool='klecks' でも 'paint-button-clicked'", () => {
    const config: OekakiPaintPopupConfig = {
      axnos: fakePopup(),
      getOekakiTool: () => "klecks",
    }
    expect(selectedPaintAction(config)).toBe("paint-button-clicked")
  })
})

describe(isPaintPopupAvailable, () => {
  test("単体 config は axnos だけ利用可", () => {
    const axnos = fakePopup()
    expect(isPaintPopupAvailable(axnos, "axnos")).toBe(true)
    expect(isPaintPopupAvailable(axnos, "klecks" as OekakiTool)).toBe(false)
  })

  test("axnos + klecks config なら両方利用可", () => {
    const config: OekakiPaintPopupConfig = {
      axnos: fakePopup(),
      klecks: fakePopup(),
    }
    expect(isPaintPopupAvailable(config, "axnos")).toBe(true)
    expect(isPaintPopupAvailable(config, "klecks")).toBe(true)
  })

  test("klecks 未設定なら klecks は利用不可", () => {
    const config: OekakiPaintPopupConfig = {
      axnos: fakePopup(),
    }
    expect(isPaintPopupAvailable(config, "axnos")).toBe(true)
    expect(isPaintPopupAvailable(config, "klecks")).toBe(false)
  })
})
