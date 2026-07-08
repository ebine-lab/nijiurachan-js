import type { FunctionComponent } from "preact"
import { h, render } from "preact"
import type {} from "#js/components/types"
import type {
    UpfileInputV2Props,
    UpfileV2Commands,
} from "#js/components/upfile-input-fragment-v2"
import type { UpfileStateFlags, UpfileUiHintFlags } from "#js/pure/upfile"
import { toUpfileStateFlags, toUpfileUiHintFlags } from "#js/pure/upfile"
import type { CustomElementClass } from "./types"

/**
 * v2添付File欄。UIボタン群 (🎨/📋/🗑など) は**内部で描画せず**、外部ツールバーが
 * `aimg:upfile-ui-hint`を購読して自前で描画することを想定した"headless"版。
 * ボタン等が押された時の効果は、host要素に生えた`clickFileattach/clickPaint/
 * clickKlecks/clickPaste/clickClear` methodを外から呼んで発動させる。
 */
export const makeUpfileInputV2Element = (
    UpfileInputV2: FunctionComponent<UpfileInputV2Props>,
): CustomElementClass =>
    // 注: 構造的に`LatestEventDetailProvider` (PreactWrapperV1/types) を満たすが、
    // elements → react の循環参照を避けるため`implements`は書かずstructural typingに頼る。
    class UpfileInputV2Element extends HTMLElement {
        static formAssociated = true
        #internals = this.attachInternals()
        #commands: UpfileV2Commands | null = null
        #latestStateFlags: UpfileStateFlags | null = null
        #latestUiHint: UpfileUiHintFlags | null = null

        static define(): void {
            customElements.define("upfile-input-v2", UpfileInputV2Element)
        }

        connectedCallback(): void {
            const allowType = this.dataset.allowType
            if (typeof allowType !== "string") {
                throw new Error("UpfileInputV2Element: allowType is not set")
            }
            const form = this.#internals.form
            if (!form) {
                throw new Error(
                    "UpfileInputV2Element: <form>の子孫として配置してください (formAssociated: true)",
                )
            }

            this.#listenReload()

            const allowImageReplies = /\bfile\b/i.test(allowType)

            // Preact render前に初期値を種まき。fragmentのmount時useEffectはまだ走らないため、
            // `useEventLatest` / AI_BBS側の `aimg:upfile-ui-hint` 直接購読のどちらから
            // "attach直後の同期pull" が来てもデフォルト (mode=empty) の値を返せるようにする。
            this.#latestStateFlags = toUpfileStateFlags("empty", {
                isPopupFormCollapsed: false,
            })
            this.#latestUiHint = toUpfileUiHintFlags("empty", {
                allowImageReplies,
            })

            render(
                h(UpfileInputV2, {
                    form: form,
                    allowImageReplies: allowImageReplies,
                    canvasWidth: 600,
                    canvasHeight: 424,
                    bindCommands: (cmds: UpfileV2Commands) => {
                        this.#commands = cmds
                    },
                    onStateChange: (flags: UpfileStateFlags) => {
                        this.#latestStateFlags = flags
                        this.dispatchEvent(
                            new CustomEvent("aimg:upfile-state", {
                                detail: flags,
                                bubbles: true,
                            }),
                        )
                    },
                    onUiHintChange: (hint: UpfileUiHintFlags) => {
                        this.#latestUiHint = hint
                        this.dispatchEvent(
                            new CustomEvent("aimg:upfile-ui-hint", {
                                detail: hint,
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
            this.#commands = null
            this.#latestStateFlags = null
            this.#latestUiHint = null
        }

        /**
         * `useEventLatest` (PreactWrapperV1) が初回dispatch前に同期で直近値を得るための
         * pull経路。push済みの値が無い場合にのみ呼ばれる。
         * 発火前は `undefined` を返す。
         */
        getLatestEventDetail(eventName: string): unknown | undefined {
            if (eventName === "aimg:upfile-state") {
                return this.#latestStateFlags ?? undefined
            }
            if (eventName === "aimg:upfile-ui-hint") {
                return this.#latestUiHint ?? undefined
            }
            return undefined
        }

        clickFileattach(): void {
            // `<input type=file>.click()` はuser activation (クリック等) 内でないと
            // ブラウザがファイルピッカーを開かない。想定外のタイミング (effectや
            // setTimeout経由など) で呼ぶと無言で失敗するので warn しておく。
            if (
                typeof navigator !== "undefined" &&
                navigator.userActivation &&
                !navigator.userActivation.isActive
            ) {
                console.warn(
                    "[upfile-input-v2] clickFileattach: user activation が無いためブラウザがファイルピッカーを開かない可能性があります。クリックハンドラ等から同期的に呼んでください。",
                )
            }
            this.#commands?.clickFileattach()
        }

        clickPaint(): void {
            this.#commands?.clickPaint()
        }

        clickKlecks(): void {
            this.#commands?.clickKlecks()
        }

        clickPaste(): void {
            this.#commands?.clickPaste()
        }

        clickClear(): void {
            this.#commands?.clickClear()
        }

        #listenReload(): void {
            this.addEventListener("aimg:reloading", this)
        }

        handleEvent(e: GlobalEventHandlersEventMap["aimg:reloading"]): void {
            if (this.#isBusy(e.detail.isFullReload)) {
                e.preventDefault()
            }
        }

        /**
         * リロードを止めたい状況かどうか判定。
         *
         * v1は`file?.hidden`をモード判定の代用にしていたが、v2は内部の
         * `<input type=file>`が常に`hidden`なので、同じトリックは使えない。
         * 代わりにfragmentから受け取った`UpfileStateFlags`を使う。
         *
         * v1は`document.getElementsByTagName("canvas").length`でホストを跨いだ
         * グローバル判定をしていたが、v2は自身の`isAxnosOpen`/`isHacchanOpen`
         * フラグだけで判定する (= 同一フォーム内の他要素や他ホストには干渉しない)。
         */
        #isBusy(isFullReload: boolean): boolean {
            if (isFullReload) {
                // 添付画像・お絵描き中なら止める
                if (this.#latestStateFlags?.isBusy) {
                    return true
                }
                const file = this.querySelector(
                    "input[type=file]",
                ) as HTMLInputElement | null

                return Boolean(file?.files?.length)
            } else {
                // 無駄な通信がいやなのでお絵描き中(アクノス・はっちゃんいずれも)は止める
                return Boolean(
                    this.#latestStateFlags?.isAxnosOpen ||
                        this.#latestStateFlags?.isKlecksOpen ||
                        this.#latestStateFlags?.isHacchanOpen,
                )
            }
        }
    }
