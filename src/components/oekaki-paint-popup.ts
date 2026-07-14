import type { UpfileAction } from "#js/pure/upfile"
import type {
  AxnosPaintPopupOptions,
  IAxnosPaintPopup,
  IKlecksPaintPopup,
  OekakiTool,
} from "./types"

type PaintPopup = {
  popup(options: AxnosPaintPopupOptions): Promise<Blob>
  abort(): void
}

export type OekakiPaintPopupConfig =
  | IAxnosPaintPopup
  | {
      axnos: IAxnosPaintPopup
      klecks?: IKlecksPaintPopup
      getOekakiTool?: () => OekakiTool
    }

type ResolvedPaintPopup = {
  popup: PaintPopup
  fileTool: string
}

function isPopupConfig(
  config: OekakiPaintPopupConfig,
): config is Exclude<OekakiPaintPopupConfig, IAxnosPaintPopup> {
  return "axnos" in config
}

export function selectedPaintAction(
  config: OekakiPaintPopupConfig,
): UpfileAction {
  return isPopupConfig(config) &&
    config.getOekakiTool?.() === "klecks" &&
    config.klecks
    ? "klecks-button-clicked"
    : "paint-button-clicked"
}

export function isPaintPopupAvailable(
  config: OekakiPaintPopupConfig,
  tool: OekakiTool,
): boolean {
  if (!isPopupConfig(config)) {
    return tool === "axnos"
  }

  return tool === "axnos" || Boolean(config.klecks)
}

export function resolvePaintPopup(
  config: OekakiPaintPopupConfig,
  tool: OekakiTool,
): ResolvedPaintPopup {
  // fileTool は setImage() で MIME サフィックス (`${image.type}+${fileTool}`)
  // として使われ、バックエンド (PostController::parseUpload) が
  // `image/{png,webp}+oekaki` / `+oekaki98` の 4 種のみ `is_oekaki=true` と
  // 判定する。Klecks でも "oekaki" を返さないとお絵描きフラグが立たない。
  if (!isPopupConfig(config)) {
    return { popup: config, fileTool: "oekaki" }
  }

  if (tool === "klecks" && config.klecks) {
    return { popup: config.klecks, fileTool: "oekaki" }
  }

  return { popup: config.axnos, fileTool: "oekaki" }
}

export function abortPaintPopups(config: OekakiPaintPopupConfig): void {
  if (!isPopupConfig(config)) {
    config.abort()
    return
  }

  config.axnos.abort()
  config.klecks?.abort()
}
