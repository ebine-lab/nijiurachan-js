import type {
    AxnosPaintPopupOptions,
    IKlecksPaintPopup,
} from "#js/components/types"

const popupHtml = `<!DOCTYPE html>
<html lang="ja">
    <meta charset="utf-8">
    <style>
    html,
    body,
    klecks-paint-host {
        display: block;
        width: 100%;
        height: 100%;
        margin: 0;
        overflow: hidden;
    }
    </style>
    <meta
        name="viewport"
        content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"
    >
    <title>Klecks</title>
</html>`

/** @inheritdoc */
export class KlecksPopup implements IKlecksPaintPopup {
    #abort?: AbortController
    #hostWindow?: Window | null

    readonly src: string
    readonly embedSrc: string

    constructor(src: string, embedSrc: string) {
        this.src = src
        this.embedSrc = embedSrc
    }

    abort(): void {
        this.#abort?.abort()
        this.#hostWindow?.close()
        this.#abort = undefined
        this.#hostWindow = undefined
    }

    popup(options: AxnosPaintPopupOptions): Promise<Blob> {
        this.abort()

        const abort = new AbortController()
        this.#abort = abort

        const popupId = `klecks-${crypto.randomUUID()}`
        return new Promise<Blob>((resolve, reject) => {
            abort.signal.addEventListener("abort", () =>
                reject(
                    new DOMException("Klecks popup was aborted", "AbortError"),
                ),
            )

            addEventListener(
                "aimg:painted",
                ({ detail }) => {
                    if (detail.popupId === popupId) {
                        detail.isAccepted = true

                        if (detail.image) {
                            resolve(detail.image)
                        } else {
                            reject(new Error("No image received from Klecks"))
                        }

                        abort?.abort()
                        this.#abort = undefined
                        this.#hostWindow = undefined
                    }
                },
                abort,
            )

            if (!this.#popupKlecks(popupId, options)) {
                reject(new Error("Failed to open Klecks popup"))
            }
        })
    }

    #popupKlecks(popupId: string, options: AxnosPaintPopupOptions): boolean {
        const hostWindow = window.open("about:blank")
        if (!hostWindow) {
            window.alert(
                "ポップアップがブロックされました。ブラウザのポップアップ設定を確認してください。",
            )
            return false
        }
        this.#hostWindow = hostWindow
        this.#initKlecks(hostWindow.document, popupId, options)
        return true
    }

    #initKlecks(
        doc: Document,
        popupId: string,
        { canvasWidth, canvasHeight }: AxnosPaintPopupOptions,
    ): void {
        doc.write(popupHtml)
        doc.close()

        const host = doc.createElement("klecks-paint-host")
        host.id = popupId
        host.dataset.width = `${canvasWidth}`
        host.dataset.height = `${canvasHeight}`
        host.dataset.embedSrc = this.embedSrc
        doc.body.appendChild(host)

        const script = doc.createElement("script")
        script.type = "module"
        script.src = this.src
        doc.head.appendChild(script)
    }
}
