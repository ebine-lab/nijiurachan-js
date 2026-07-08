type KlecksSubmitCallback = (onSuccess: () => void, onError: () => void) => void

type KlecksProject = {
    width: number
    height: number
    layers: [
        {
            name: string
            isVisible: true
            opacity: 1
            mixModeStr: "source-over"
            image: { fill: string }
        },
    ]
}

type KlecksEmbed = {
    openProject(project: KlecksProject): void
    getPNG(): Promise<Blob>
}

type KlecksConstructor = new (options: {
    onSubmit: KlecksSubmitCallback
}) => KlecksEmbed

declare global {
    interface Window {
        Klecks?: KlecksConstructor
    }
}

export class KlecksPaintHostElement extends HTMLElement {
    static define(): void {
        customElements.define("klecks-paint-host", KlecksPaintHostElement)
    }

    async connectedCallback(): Promise<void> {
        await this.#runKlecks()
    }

    async #runKlecks(): Promise<void> {
        try {
            window.onbeforeunload = (): boolean => true

            await this.#loadEmbedScript()
            this.#startKlecks()
        } catch (error) {
            window.onbeforeunload = null
            console.error("Error in Klecks:", error)
            this.#send(null)
        }
    }

    async #loadEmbedScript(): Promise<void> {
        const src = this.dataset.embedSrc
        if (!src) {
            throw new Error("Klecks embed src is not set")
        }

        await new Promise<void>((resolve, reject) => {
            const script = document.createElement("script")
            script.src = src
            script.onload = (): void => resolve()
            script.onerror = (): void =>
                reject(new Error(`Failed to load Klecks embed: ${src}`))
            document.head.appendChild(script)
        })

        if (!window.Klecks) {
            throw new Error("Klecks embed did not expose window.Klecks")
        }
    }

    #startKlecks(): void {
        const Klecks = window.Klecks
        if (!Klecks) {
            throw new Error("Klecks is not available")
        }

        const klecks = new Klecks({
            onSubmit: async (
                onSuccess: () => void,
                onError: () => void,
            ): Promise<void> => {
                try {
                    const image = await klecks.getPNG()
                    this.#send(image)
                    onSuccess()
                    window.onbeforeunload = null
                    window.close()
                } catch (error) {
                    console.error("Failed to submit Klecks image:", error)
                    onError()
                }
            },
        })

        klecks.openProject(this.#makeInitialProject())
    }

    #makeInitialProject(): KlecksProject {
        const width = this.#parseCanvasSide(this.dataset.width, 600)
        const height = this.#parseCanvasSide(this.dataset.height, 424)
        return {
            width,
            height,
            layers: [
                {
                    name: "Background",
                    isVisible: true,
                    opacity: 1,
                    mixModeStr: "source-over",
                    image: { fill: "#fff" },
                },
            ],
        }
    }

    #parseCanvasSide(value: string | undefined, fallback: number): number {
        const parsed = Number(value)
        if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 4096) {
            return fallback
        }
        return parsed
    }

    #send(image: Blob | null): void {
        const o = window.opener as Window | null
        if (!o || o.closed) {
            if (image) {
                alert(
                    "投稿先の親タブが閉じられてしまったようです。\nKlecks側からPNGで保存できます。",
                )
                throw Error("opener already closed")
            }
            return
        }
        const e = new CustomEvent("aimg:painted", {
            detail: {
                image,
                popupId: this.id,
                isAccepted: false,
            },
        }) satisfies GlobalEventHandlersEventMap["aimg:painted"]
        o.dispatchEvent(e)

        if (image && !e.detail.isAccepted) {
            alert(
                "投稿先の親タブが待ち受けを終了してしまったようです。\nKlecks側からPNGで保存できます。",
            )
            throw Error("opener already cleared")
        }
    }
}
