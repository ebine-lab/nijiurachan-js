import type { FunctionComponent } from "preact"
import { h, render } from "preact"
import type {} from "#js/components/types"
import type { UpfileInputProps } from "#js/components/upfile-input-fragment"
import type { UpfileStateFlags } from "#js/pure/upfile"
import type { CustomElementClass } from "./types"

/**
 * 添付File欄。ファイル選択欄とお絵描きボタンを持つ。
 * @param UpfileInput 添付File欄
 */
export const makeUpfileInputElement = (
    UpfileInput: FunctionComponent<UpfileInputProps>,
): CustomElementClass =>
    class UpfileInputElement extends HTMLElement {
        static formAssociated = true
        #internals = this.attachInternals()

        static define(): void {
            customElements.define("upfile-input", UpfileInputElement)
        }

        connectedCallback(): void {
            const allowType = this.dataset.allowType
            if (typeof allowType !== "string") {
                throw new Error("UpfileInputElement: allowType is not set")
            }
            const form = this.#internals.form
            if (!form) {
                throw new Error("UpfileInputElement: form is not associated")
            }

            this.#listenReload()

            const allowImageReplies = /\bfile\b/i.test(allowType)

            render(
                h(UpfileInput, {
                    form: form,
                    allowImageReplies: allowImageReplies,
                    canvasWidth: 600,
                    canvasHeight: 424,
                    onStateChange: (flags: UpfileStateFlags) => {
                        this.dispatchEvent(
                            new CustomEvent("aimg:upfile-state", {
                                detail: flags,
                                bubbles: true,
                            }),
                        )
                    },
                }),
                this,
            )
        }

        disconnectedCallback(): void {
            this.removeEventListener("aimg:reloading", this)
            render(null, this)
        }

        #listenReload(): void {
            this.addEventListener("aimg:reloading", this)
        }

        handleEvent(e: GlobalEventHandlersEventMap["aimg:reloading"]): void {
            if (this.#isBusy(e.detail.isFullReload)) {
                e.preventDefault()
            }
        }

        /** リロードを止めたい状況かどうか判定 */
        #isBusy(isFullReload: boolean): boolean {
            if (isFullReload) {
                // 添付画像があったら止める
                const file = this.querySelector(
                    "input[type=file]",
                ) as HTMLInputElement | null

                return Boolean(file?.files?.length || file?.hidden)
            } else {
                // 無駄な通信がいやなのではっちゃんが開いているとき止める
                return 2 <= document.getElementsByTagName("canvas").length
            }
        }
    }
