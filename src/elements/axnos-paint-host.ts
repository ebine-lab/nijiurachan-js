import AXNOSPaint from "axnospaint-for-aimg"
/**
 * アクノスペイントを使うポップアップページに置く要素
 */
export class AxnosPaintHostElement extends HTMLElement {
    /** この要素を登録 */
    static define(): void {
        customElements.define("axnos-paint-host", AxnosPaintHostElement)
    }

    async connectedCallback(): Promise<void> {
        await this.#runAxnos()
    }

    async #runAxnos(): Promise<void> {
        try {
            window.onbeforeunload = (): boolean => true

            await this.#startAxnos()

            const image = await this.#finish()
            this.#send(image)

            window.onbeforeunload = null
            window.close()
        } catch (error) {
            console.error("Error in axnos paint:", error)
            this.#send(null)
        }
    }

    #send(image: Blob | null): void {
        const o = window.opener as Window | null
        if (!o && image) {
            alert(
                "投稿先の親タブが閉じられてしまったようです。\n設定タブからPNGで保存できます。",
            )
            throw Error("opener already closed")
        }
        const e = new CustomEvent("aimg:painted", {
            detail: {
                image,
                popupId: this.id,
                isAccepted: false,
            },
        }) satisfies GlobalEventHandlersEventMap["aimg:painted"]
        o?.dispatchEvent(e)

        if (image && !e.detail.isAccepted) {
            alert(
                "投稿先の親タブが待ち受けを終了してしまったようです。\n設定タブからPNGで保存できます。",
            )
            throw Error("opener already cleared")
        }
    }

    /**
     * アクノスペイントを表示し、完了を待つ
     * @return お絵描き完了すると解決するプロミス
     */
    async #startAxnos(): Promise<void> {
        // ソースを覗いている絵心のある「」へ：初期パレットは適当なのでWikiでおすすめを載せたりﾒなどでご提案お願いします…
        const palette = [
            "#800000",
            "#8c2319",
            "#98392c",
            "#a34c3f",
            "#ae5f51",
            "#b87163",
            "#c28375",
            "#cc9588",
            "#d6a89b",
            "#dfbaae",
            "#e8cdc2",
            "#f0e0d6",
            "#ffffff",
            "#bebebe",
            "#808080",
            "#484848",
            "#161616",
            "#000000",
            "#ff0000",
            "#ffa000",
            "#ffff00",
            "#b0ff00",
            "#00ff00",
            "#00ffa9",
            "#00ffff",
            "#00a0ff",
            "#0000ff",
            "#9038ff",
            "#ff00ff",
            "#fd2d9b",
        ]

        const width = Number.parseInt(this.dataset.width ?? "", 10) || 600
        const height = Number.parseInt(this.dataset.height ?? "", 10) || 424

        return new Promise((resolve) => {
            new AXNOSPaint({
                bodyId: this.id,
                maxWidth: 1000,
                maxHeight: 1000,
                width,
                height,
                checkSameBBS: false,
                restrictPost: true,
                expansionTab: {
                    name: "完了",
                    msg: "お絵描きを終えて、投稿に添付します。(ロスレスWebP一枚になります)",
                    function: resolve,
                },
                defaultColor: {
                    main: palette[0] as string,
                    sub: palette[11] as string,
                    palette,
                },
            })
        })
    }

    /** 完了タブが押されたときの処理。キャンバスを画像データにする */
    #finish(): Promise<Blob | null> {
        // このイベントを送るとアクノスペイントがキャンバスを一枚に仕上げてくれる
        document.dispatchEvent(new Event("visibilitychange"))

        const c = this.querySelector(
            ".axpc_post_overlayCanvas",
        ) as HTMLCanvasElement
        if (!c) return Promise.resolve(null)

        return new Promise((resolve) => c.toBlob(resolve, "image/webp", 1))
    }
}
