import type {
  AxnosPaintPopupOptions,
  IAxnosPaintPopup,
} from "#js/components/types"

/**
 * ポップアップに表示するHTML内容
 * scriptタグとaxnos-paint-hostタグはJSで作って足す
 */
const popupHtml = `<!DOCTYPE html>
<html lang="ja">
    <meta charset="utf-8">
    <style>
    html,
    #axp_canvas_div_grayBackground {
        background: #666 !important;
    }

    #axp_config_div_nav,
    .axpc_config_chapter {
        background: #ffe !important;
    }
    </style>
    <meta
        name="viewport"
        content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"
    >
    <title>AXNOS Paint for αimg</title>
</html>`

/** @inheritdoc */
export class AxnosPaintPopup implements IAxnosPaintPopup {
  #abort?: AbortController

  // consumer側tsconfigが`erasableSyntaxOnly: true`のとき parameter property
  // (readonly src: string) は TS1294 になるため、明示フィールドに展開する。
  readonly src: string

  /** @param src ポップアップに読み込むスクリプトのURL */
  constructor(src: string) {
    this.src = src
  }

  abort(): void {
    this.#abort?.abort()
  }

  popup(options: AxnosPaintPopupOptions): Promise<Blob> {
    this.abort()

    const abort = new AbortController()
    this.#abort = abort

    const popupId = `otegaki-${crypto.randomUUID()}`
    return new Promise<Blob>((resolve, reject) => {
      abort.signal.addEventListener("abort", reject)

      addEventListener(
        "aimg:painted",
        ({ detail }) => {
          if (detail.popupId === popupId) {
            detail.isAccepted = true

            if (detail.image) {
              resolve(detail.image)
            } else {
              reject(new Error("No image received from axnospaint"))
            }

            abort?.abort()
            this.#abort = undefined
          }
        },
        abort,
      )

      if (!this.#popupAxnosPaint(popupId, options)) {
        reject(new Error("Failed to open axnos paint popup"))
      }
    })
  }

  /** アクノスペイントのポップアップを開く */
  #popupAxnosPaint(popupId: string, options: AxnosPaintPopupOptions): boolean {
    const hostWindow = window.open("about:blank")
    if (!hostWindow) {
      window.alert(
        "ポップアップがブロックされました。ブラウザのポップアップ設定を確認してください。",
      )
      return false
    }
    this.#initAxnosPaint(hostWindow.document, popupId, options)
    return true
  }

  /** ドキュメントにアクノスペイントを読み込む */
  #initAxnosPaint(
    doc: Document,
    popupId: string,
    { canvasWidth, canvasHeight }: AxnosPaintPopupOptions,
  ): void {
    doc.write(popupHtml)
    doc.close()

    const host = doc.createElement("axnos-paint-host")
    host.id = popupId
    host.dataset.width = `${canvasWidth}`
    host.dataset.height = `${canvasHeight}`
    doc.body.appendChild(host)

    const script = doc.createElement("script")
    script.type = "module"
    script.src = this.src
    doc.head.appendChild(script)
  }
}
