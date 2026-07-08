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
    openStorageProject?(project: KlecksStorageProject): Promise<void>
    getPNG(): Promise<Blob>
    getStorageProject?(): Promise<KlecksStorageProject>
}

type KlecksConstructor = new (options: {
    onSubmit: KlecksSubmitCallback
    bottomBar?: HTMLElement
}) => KlecksEmbed

declare global {
    interface Window {
        Klecks?: KlecksConstructor
    }
}

export const KLECKS_CLOUD_DRAFTS_STORAGE_KEY = "aimg-klecks-cloud-drafts"

type SerializedBlob = {
    contentType: string
    size: number
    data: string
}

type KlecksStorageProject = {
    id: 1
    projectId: string
    timestamp: number
    thumbnail: Blob
    width: number
    height: number
    layers: {
        name: string
        isVisible: boolean
        opacity: number
        mixModeStr: string
        blob: Blob
    }[]
}

type SerializedKlecksStorageProject = Omit<
    KlecksStorageProject,
    "thumbnail" | "layers"
> & {
    thumbnail: SerializedBlob
    layers: (Omit<KlecksStorageProject["layers"][number], "blob"> & {
        blob: SerializedBlob
    })[]
}

type CloudDraftSummary = {
    id: string
    title?: string
    width?: number
    height?: number
    total_bytes?: number
    updated_at?: string
}

type CloudDraftState = {
    saveKey?: string
    drafts: Record<string, CloudDraftSummary>
}

type CloudDraftResult = {
    saveKey: string
    draft: CloudDraftSummary
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
            await this.#startKlecks()
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

    async #startKlecks(): Promise<void> {
        const Klecks = window.Klecks
        if (!Klecks) {
            throw new Error("Klecks is not available")
        }

        let klecks: KlecksEmbed
        const bottomBar = this.#createBottomBar(() => klecks)
        klecks = new Klecks({
            bottomBar,
            onSubmit: async (
                onSuccess: () => void,
                onError: () => void,
            ): Promise<void> => {
                try {
                    const image = await klecks.getPNG()
                    const cloudDraft = await this.#saveCloudDraft(
                        klecks,
                        image,
                    ).catch((error: unknown) => {
                        console.warn(
                            "Failed to save Klecks cloud draft:",
                            error,
                        )
                        return null
                    })
                    this.#send(image, cloudDraft)
                    onSuccess()
                    window.onbeforeunload = null
                    window.close()
                } catch (error) {
                    console.error("Failed to submit Klecks image:", error)
                    onError()
                }
            },
        })

        await this.#openInitialProject(klecks)
    }

    #createBottomBar(getKlecks: () => KlecksEmbed): HTMLElement {
        const wrapper = document.createElement("div")
        wrapper.style.display = "flex"
        wrapper.style.alignItems = "center"
        wrapper.style.gap = "8px"

        const saveButton = document.createElement("button")
        saveButton.type = "button"
        saveButton.textContent = "クラウド保存"
        saveButton.addEventListener("click", () => {
            void this.#saveFromButton(getKlecks(), saveButton)
        })
        wrapper.append(saveButton)

        return wrapper
    }

    async #saveFromButton(
        klecks: KlecksEmbed,
        saveButton: HTMLButtonElement,
    ): Promise<void> {
        const previousText = saveButton.textContent ?? "クラウド保存"
        saveButton.disabled = true
        saveButton.textContent = "保存中"
        try {
            const image = await klecks.getPNG()
            await this.#saveCloudDraft(klecks, image)
            saveButton.textContent = "保存済み"
        } catch (error) {
            console.warn("Failed to save Klecks cloud draft:", error)
            saveButton.textContent = "保存失敗"
        } finally {
            window.setTimeout(() => {
                saveButton.disabled = false
                saveButton.textContent = previousText
            }, 1200)
        }
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

    async #openInitialProject(klecks: KlecksEmbed): Promise<void> {
        const storageProject = await this.#loadCloudDraftProject().catch(
            (error: unknown) => {
                console.warn("Failed to load Klecks cloud draft:", error)
                return null
            },
        )
        if (storageProject && typeof klecks.openStorageProject === "function") {
            await klecks.openStorageProject(storageProject)
            return
        }

        klecks.openProject(this.#makeInitialProject())
    }

    async #loadCloudDraftProject(): Promise<KlecksStorageProject | null> {
        const state = readCloudDraftState()
        if (!state.saveKey) {
            return null
        }

        const draft = await this.#latestCloudDraft(state)
        if (!draft) {
            return null
        }

        const response = await fetch(this.#draftApiUrl(draft.id), {
            method: "GET",
            headers: {
                "X-Oekaki-Save-Key": state.saveKey,
            },
        })
        const result = (await response.json()) as
            | {
                  ok: true
                  data: { draft: { source: SerializedKlecksStorageProject } }
              }
            | { ok: false; error?: string }
        if (!response.ok || !result.ok) {
            throw new Error(
                result.ok ? "Klecks cloud draft load failed" : result.error,
            )
        }

        return deserializeStorageProject(result.data.draft.source)
    }

    async #latestCloudDraft(
        state: CloudDraftState,
    ): Promise<CloudDraftSummary | null> {
        const localDraft = latestCloudDraft(state)
        const saveKey = state.saveKey
        if (localDraft || !saveKey) {
            return localDraft
        }

        const response = await fetch(this.#draftApiUrl(), {
            method: "GET",
            headers: {
                "X-Oekaki-Save-Key": saveKey,
            },
        })
        const result = (await response.json()) as
            | {
                  ok: true
                  data: { drafts: CloudDraftSummary[] }
              }
            | { ok: false; error?: string }
        if (!response.ok || !result.ok) {
            throw new Error(
                result.ok
                    ? "Klecks cloud draft index load failed"
                    : result.error,
            )
        }

        const nextState: CloudDraftState = {
            saveKey,
            drafts: Object.fromEntries(
                result.data.drafts.map((draft) => [draft.id, draft]),
            ),
        }
        localStorage.setItem(
            KLECKS_CLOUD_DRAFTS_STORAGE_KEY,
            JSON.stringify(nextState),
        )

        return latestCloudDraft(nextState)
    }

    async #saveCloudDraft(
        klecks: KlecksEmbed,
        image: Blob,
    ): Promise<CloudDraftResult | null> {
        if (typeof klecks.getStorageProject !== "function") {
            return null
        }

        const project = await klecks.getStorageProject()
        const state = readCloudDraftState()
        const source = await serializeStorageProject(project)
        const body = {
            save_key: state.saveKey,
            draft_id: project.projectId,
            title: "Klecks draft",
            width: project.width,
            height: project.height,
            source,
            preview_base64: await blobToBase64(image),
        }
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
        }
        if (state.saveKey) {
            headers["X-Oekaki-Save-Key"] = state.saveKey
        }

        const response = await fetch(this.#draftApiUrl(), {
            method: "POST",
            headers,
            body: JSON.stringify(body),
        })
        const result = (await response.json()) as
            | {
                  ok: true
                  data: { save_key: string; draft: CloudDraftSummary }
              }
            | { ok: false; error?: string }

        if (!response.ok || !result.ok) {
            throw new Error(
                result.ok ? "Klecks cloud draft save failed" : result.error,
            )
        }

        const nextState: CloudDraftState = {
            saveKey: result.data.save_key,
            drafts: {
                ...state.drafts,
                [result.data.draft.id]: result.data.draft,
            },
        }
        localStorage.setItem(
            KLECKS_CLOUD_DRAFTS_STORAGE_KEY,
            JSON.stringify(nextState),
        )

        return {
            saveKey: result.data.save_key,
            draft: result.data.draft,
        }
    }

    #draftApiUrl(draftId?: string): string {
        const base = (this.dataset.draftApi || "/api/oekaki-drafts").replace(
            /\/$/,
            "",
        )
        return draftId ? `${base}/${encodeURIComponent(draftId)}` : base
    }

    #send(
        image: Blob | null,
        cloudDraft: CloudDraftResult | null = null,
    ): void {
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
                cloudDraft,
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

async function serializeStorageProject(
    project: KlecksStorageProject,
): Promise<SerializedKlecksStorageProject> {
    return {
        id: project.id,
        projectId: project.projectId,
        timestamp: project.timestamp,
        thumbnail: await serializeBlob(project.thumbnail),
        width: project.width,
        height: project.height,
        layers: await Promise.all(
            project.layers.map(async ({ blob, ...layer }) => ({
                ...layer,
                blob: await serializeBlob(blob),
            })),
        ),
    }
}

function latestCloudDraft(state: CloudDraftState): CloudDraftSummary | null {
    return (
        Object.values(state.drafts).sort((a, b) =>
            String(b.updated_at ?? "").localeCompare(
                String(a.updated_at ?? ""),
            ),
        )[0] ?? null
    )
}

function deserializeStorageProject(
    project: SerializedKlecksStorageProject,
): KlecksStorageProject {
    return {
        id: 1,
        projectId: project.projectId,
        timestamp: project.timestamp,
        thumbnail: deserializeBlob(project.thumbnail),
        width: project.width,
        height: project.height,
        layers: project.layers.map(({ blob, ...layer }) => ({
            ...layer,
            blob: deserializeBlob(blob),
        })),
    }
}

function deserializeBlob(blob: SerializedBlob): Blob {
    const binary = atob(blob.data)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
    }

    return new Blob([bytes], { type: blob.contentType })
}

async function serializeBlob(blob: Blob): Promise<SerializedBlob> {
    return {
        contentType: blob.type || "application/octet-stream",
        size: blob.size,
        data: await blobToBase64(blob),
    }
}

async function blobToBase64(blob: Blob): Promise<string> {
    if (typeof blob.arrayBuffer !== "function") {
        return await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = (): void => {
                const result = String(reader.result ?? "")
                const commaIndex = result.indexOf(",")
                resolve(
                    commaIndex === -1 ? result : result.slice(commaIndex + 1),
                )
            }
            reader.onerror = (): void => reject(reader.error)
            reader.readAsDataURL(blob)
        })
    }

    const bytes = new Uint8Array(await blob.arrayBuffer())
    let binary = ""
    const chunkSize = 0x8000
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
    }

    return btoa(binary)
}

function readCloudDraftState(): CloudDraftState {
    try {
        const raw = localStorage.getItem(KLECKS_CLOUD_DRAFTS_STORAGE_KEY)
        if (!raw) {
            return { drafts: {} }
        }
        const parsed = JSON.parse(raw) as Partial<CloudDraftState>
        return {
            saveKey:
                typeof parsed.saveKey === "string" ? parsed.saveKey : undefined,
            drafts:
                parsed.drafts && typeof parsed.drafts === "object"
                    ? parsed.drafts
                    : {},
        }
    } catch {
        return { drafts: {} }
    }
}
