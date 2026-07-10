import {
    afterEach,
    beforeEach,
    describe,
    expect,
    type Mock,
    test,
    vi,
} from "vitest"
import {
    KLECKS_CLOUD_DRAFTS_STORAGE_KEY,
    KlecksPaintHostElement,
} from "#js/elements/klecks-paint-host"

type FakeKlecksOptions = ConstructorParameters<
    NonNullable<typeof window.Klecks>
>[0]
type FakeKlecksProject = Parameters<
    InstanceType<NonNullable<typeof window.Klecks>>["openProject"]
>[0]
type FakeKlecksStorageProject = Awaited<
    ReturnType<
        NonNullable<
            InstanceType<NonNullable<typeof window.Klecks>>["getStorageProject"]
        >
    >
>

const TAG = "klecks-paint-host-test"
if (!customElements.get(TAG)) {
    customElements.define(TAG, KlecksPaintHostElement)
}

const nextTask = (): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, 0))

async function flushMicrotasks(count: number = 20): Promise<void> {
    for (let i = 0; i < count; i++) {
        await Promise.resolve()
    }
}

async function waitUntil(predicate: () => boolean): Promise<void> {
    for (let i = 0; i < 20; i++) {
        if (predicate()) {
            return
        }
        await nextTask()
    }
    throw new Error("condition was not reached")
}

describe(KlecksPaintHostElement, () => {
    let appendSpy: Mock<typeof document.head.appendChild> | undefined
    let alertSpy: Mock<typeof window.alert> | undefined
    let errorSpy: Mock<typeof console.error> | undefined
    let fetchSpy: Mock<typeof fetch> | undefined
    let closeSpy: Mock<typeof window.close> | undefined
    let canvasContextSpy:
        | Mock<typeof HTMLCanvasElement.prototype.getContext>
        | undefined
    let canvasToBlobSpy:
        | Mock<typeof HTMLCanvasElement.prototype.toBlob>
        | undefined

    beforeEach(() => {
        const values = new Map<string, string>()
        const storage = {
            clear: vi.fn(() => values.clear()),
            getItem: vi.fn((key: string) => values.get(key) ?? null),
            removeItem: vi.fn((key: string) => values.delete(key)),
            setItem: vi.fn((key: string, value: string) => {
                values.set(key, value)
            }),
        }
        Object.defineProperty(globalThis, "localStorage", {
            configurable: true,
            value: storage,
        })
        Object.defineProperty(window, "localStorage", {
            configurable: true,
            value: storage,
        })
    })

    afterEach(() => {
        appendSpy?.mockRestore()
        alertSpy?.mockRestore()
        errorSpy?.mockRestore()
        fetchSpy?.mockRestore()
        closeSpy?.mockRestore()
        canvasContextSpy?.mockRestore()
        canvasToBlobSpy?.mockRestore()
        appendSpy = undefined
        alertSpy = undefined
        errorSpy = undefined
        fetchSpy = undefined
        closeSpy = undefined
        canvasContextSpy = undefined
        canvasToBlobSpy = undefined
        vi.unstubAllGlobals()
        window.Klecks = undefined
        window.onbeforeunload = null
        localStorage.clear()
        Object.defineProperty(window, "opener", {
            configurable: true,
            value: null,
        })
        document.body.innerHTML = ""
        document.head.querySelectorAll("script").forEach((script) => {
            script.remove()
        })
    })

    test("起動失敗時にbeforeunloadを解除する", async () => {
        errorSpy = vi.spyOn(console, "error").mockReturnValue(undefined)
        Object.defineProperty(window, "opener", {
            configurable: true,
            value: {
                closed: false,
                dispatchEvent: vi.fn(),
            },
        })

        const host = document.createElement(TAG)
        document.body.appendChild(host)
        await nextTask()

        expect(window.onbeforeunload).toBeNull()
    })

    test("送信時に親ウィンドウが閉じていたらdispatchしない", async () => {
        const image = new Blob(["image"], { type: "image/png" })
        const opener = {
            closed: true,
            dispatchEvent: vi.fn(),
        }
        Object.defineProperty(window, "opener", {
            configurable: true,
            value: opener,
        })
        alertSpy = vi.spyOn(window, "alert").mockReturnValue(undefined)
        errorSpy = vi.spyOn(console, "error").mockReturnValue(undefined)
        mockScriptLoad()
        window.Klecks = class FakeKlecks {
            readonly #options: FakeKlecksOptions

            constructor(options: FakeKlecksOptions) {
                this.#options = options
            }

            openProject(): void {
                void this.#options.onSubmit(
                    () => undefined,
                    () => undefined,
                )
            }

            getPNG(): Promise<Blob> {
                return Promise.resolve(image)
            }
        }

        const host = document.createElement(TAG)
        host.dataset.embedSrc = "embed.js"
        document.body.appendChild(host)
        await nextTask()
        await nextTask()

        expect(opener.dispatchEvent).not.toHaveBeenCalled()
        expect(alertSpy).toHaveBeenCalled()
    })

    test("不正なキャンバスサイズは既定値に丸める", async () => {
        let project: FakeKlecksProject | undefined
        Object.defineProperty(window, "opener", {
            configurable: true,
            value: {
                closed: false,
                dispatchEvent: vi.fn(),
            },
        })
        mockScriptLoad()
        window.Klecks = class FakeKlecks {
            openProject(nextProject: FakeKlecksProject): void {
                project = nextProject
            }

            getPNG(): Promise<Blob> {
                return Promise.resolve(new Blob())
            }
        }

        const host = document.createElement(TAG)
        host.dataset.embedSrc = "embed.js"
        host.dataset.width = "-1"
        host.dataset.height = "9999999999"
        document.body.appendChild(host)
        await nextTask()
        await nextTask()

        expect(project?.width).toBe(600)
        expect(project?.height).toBe(424)
    })

    test("送信時に保存用プロジェクトをクラウド下書きAPIへ送る", async () => {
        const image = new Blob(["image"], { type: "image/png" })
        const opener = {
            closed: false,
            dispatchEvent: vi.fn((event: Event) => {
                if (event instanceof CustomEvent) {
                    event.detail.isAccepted = true
                }
                return true
            }),
        }
        Object.defineProperty(window, "opener", {
            configurable: true,
            value: opener,
        })
        fetchSpy = vi.spyOn(window, "fetch").mockResolvedValue({
            ok: true,
            json: () =>
                Promise.resolve({
                    ok: true,
                    data: {
                        save_key: "a".repeat(64),
                        draft: {
                            id: "project-1",
                            title: "Klecks draft",
                            updated_at: "2026-07-08T00:00:00+00:00",
                            width: 123,
                            height: 456,
                            total_bytes: 10,
                        },
                    },
                }),
        } as Response)
        closeSpy = vi.spyOn(window, "close").mockReturnValue(undefined)
        mockPreviewWebpEncoding("webp-preview")
        mockScriptLoad()
        window.Klecks = class FakeKlecks {
            readonly #options: FakeKlecksOptions

            constructor(options: FakeKlecksOptions) {
                this.#options = options
            }

            openProject(): void {
                void this.#options.onSubmit(
                    () => undefined,
                    () => undefined,
                )
            }

            getPNG(): Promise<Blob> {
                return Promise.resolve(image)
            }

            getStorageProject(): Promise<FakeKlecksStorageProject> {
                return Promise.resolve({
                    id: 1 as const,
                    projectId: "project-1",
                    timestamp: 1,
                    thumbnail: new Blob(["thumbnail"], { type: "image/png" }),
                    width: 123,
                    height: 456,
                    layers: [
                        {
                            name: "Background",
                            isVisible: true,
                            opacity: 1,
                            mixModeStr: "source-over",
                            blob: new Blob(["layer"], { type: "image/png" }),
                        },
                    ],
                })
            }
        }

        const host = document.createElement(TAG)
        host.dataset.embedSrc = "embed.js"
        host.dataset.draftApi = "/api/oekaki-drafts"
        document.body.appendChild(host)
        await waitUntil(() => fetchSpy?.mock.calls.length === 1)
        await waitUntil(() => opener.dispatchEvent.mock.calls.length === 1)

        expect(fetchSpy).toHaveBeenCalledOnce()
        const fetchCall = fetchSpy.mock.calls[0]
        expect(fetchCall).toBeDefined()
        const [url, init] = fetchCall ?? []
        expect(url).toBe("/api/oekaki-drafts")
        expect(init?.method).toBe("POST")
        expect(init?.signal).toBeInstanceOf(AbortSignal)
        const body = JSON.parse(String(init?.body))
        expect(body.draft_id).toBe("project-1")
        expect(body.width).toBe(123)
        expect(body.height).toBe(456)
        expect(body.source.layers[0].blob.data).toBe(btoa("layer"))
        expect(body.preview_base64).toBeUndefined()
        expect(body.preview_data_url).toBe(
            `data:image/webp;base64,${btoa("webp-preview")}`,
        )
        expect(localStorage.getItem("aimg-klecks-cloud-drafts")).toContain(
            "aaaaaaaa",
        )
        expect(opener.dispatchEvent).toHaveBeenCalled()
    })

    test("下部バーのクラウド保存ボタンで投稿せずに保存する", async () => {
        const image = new Blob(["image"], { type: "image/png" })
        const opener = {
            closed: false,
            dispatchEvent: vi.fn(),
        }
        Object.defineProperty(window, "opener", {
            configurable: true,
            value: opener,
        })
        fetchSpy = vi.spyOn(window, "fetch").mockResolvedValue({
            ok: true,
            json: () =>
                Promise.resolve({
                    ok: true,
                    data: {
                        save_key: "c".repeat(64),
                        draft: {
                            id: "project-button",
                            title: "Klecks draft",
                            updated_at: "2026-07-08T00:00:00+00:00",
                            width: 200,
                            height: 100,
                            total_bytes: 10,
                        },
                    },
                }),
        } as Response)
        let bottomBar: HTMLElement | undefined
        mockPreviewWebpEncoding("button-webp-preview")
        mockScriptLoad()
        window.Klecks = class FakeKlecks {
            constructor(options: FakeKlecksOptions) {
                bottomBar = options.bottomBar
            }

            openProject(): void {
                return
            }

            getPNG(): Promise<Blob> {
                return Promise.resolve(image)
            }

            getStorageProject(): Promise<FakeKlecksStorageProject> {
                return Promise.resolve({
                    id: 1 as const,
                    projectId: "project-button",
                    timestamp: 1,
                    thumbnail: new Blob(["thumbnail"], { type: "image/png" }),
                    width: 200,
                    height: 100,
                    layers: [
                        {
                            name: "Background",
                            isVisible: true,
                            opacity: 1,
                            mixModeStr: "source-over",
                            blob: new Blob(["layer"], { type: "image/png" }),
                        },
                    ],
                })
            }
        }

        const host = document.createElement(TAG)
        host.dataset.embedSrc = "embed.js"
        host.dataset.draftApi = "/api/oekaki-drafts"
        document.body.appendChild(host)
        await waitUntil(() => bottomBar !== undefined)

        const saveButton = bottomBar?.querySelector("button")
        expect(saveButton?.textContent).toBe("クラウド保存")
        saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
        await waitUntil(() => fetchSpy?.mock.calls.length === 1)

        expect(fetchSpy).toHaveBeenCalledOnce()
        const [, init] = fetchSpy.mock.calls[0] ?? []
        const body = JSON.parse(String(init?.body))
        expect(body.preview_base64).toBeUndefined()
        expect(body.preview_data_url).toBe(
            `data:image/webp;base64,${btoa("button-webp-preview")}`,
        )
        expect(opener.dispatchEvent).not.toHaveBeenCalled()
        expect(localStorage.getItem(KLECKS_CLOUD_DRAFTS_STORAGE_KEY)).toContain(
            "cccccccc",
        )
    })

    test("保存済みクラウド下書きがあれば起動時に復元する", async () => {
        const saveKey = "b".repeat(64)
        localStorage.setItem(
            KLECKS_CLOUD_DRAFTS_STORAGE_KEY,
            JSON.stringify({
                saveKey,
                drafts: {
                    draft_api: {
                        id: "draft_api",
                        updated_at: "2026-07-08T00:00:00+00:00",
                    },
                },
            }),
        )
        Object.defineProperty(window, "opener", {
            configurable: true,
            value: {
                closed: false,
                dispatchEvent: vi.fn(),
            },
        })
        fetchSpy = vi.spyOn(window, "fetch").mockResolvedValue({
            ok: true,
            json: () =>
                Promise.resolve({
                    ok: true,
                    data: {
                        draft: {
                            source: {
                                id: 1,
                                projectId: "project-restored",
                                timestamp: 1,
                                thumbnail: {
                                    contentType: "image/png",
                                    size: 9,
                                    data: btoa("thumbnail"),
                                },
                                width: 321,
                                height: 654,
                                layers: [
                                    {
                                        name: "Restored",
                                        isVisible: true,
                                        opacity: 1,
                                        mixModeStr: "source-over",
                                        blob: {
                                            contentType: "image/png",
                                            size: 5,
                                            data: btoa("layer"),
                                        },
                                    },
                                ],
                            },
                        },
                    },
                }),
        } as Response)
        let blankProject: FakeKlecksProject | undefined
        let restoredProject: unknown
        mockScriptLoad()
        window.Klecks = class FakeKlecks {
            openProject(nextProject: FakeKlecksProject): void {
                blankProject = nextProject
            }

            getPNG(): Promise<Blob> {
                return Promise.resolve(new Blob())
            }

            openStorageProject(project: unknown): Promise<void> {
                restoredProject = project
                return Promise.resolve()
            }
        }

        const host = document.createElement(TAG)
        host.dataset.embedSrc = "embed.js"
        host.dataset.draftApi = "/api/oekaki-drafts"
        document.body.appendChild(host)
        await waitUntil(() => restoredProject !== undefined)

        expect(fetchSpy).toHaveBeenCalledOnce()
        const [url, init] = fetchSpy.mock.calls[0] ?? []
        expect(url).toBe("/api/oekaki-drafts/draft_api")
        expect(init?.signal).toBeInstanceOf(AbortSignal)
        expect(
            (init?.headers as Record<string, string>)["X-Oekaki-Save-Key"],
        ).toBe(saveKey)
        expect(restoredProject).toMatchObject({
            projectId: "project-restored",
            width: 321,
            height: 654,
            layers: [{ name: "Restored" }],
        })
        expect(blankProject).toBeUndefined()
    })

    test("Klecks の復元 API が遅れて準備されても白紙を開かず下書きを復元する", async () => {
        const saveKey = "f".repeat(64)
        localStorage.setItem(
            KLECKS_CLOUD_DRAFTS_STORAGE_KEY,
            JSON.stringify({
                saveKey,
                drafts: {
                    draft_delayed_api: {
                        id: "draft_delayed_api",
                        updated_at: "2026-07-10T00:00:00+00:00",
                    },
                },
            }),
        )
        Object.defineProperty(window, "opener", {
            configurable: true,
            value: {
                closed: false,
                dispatchEvent: vi.fn(),
            },
        })
        fetchSpy = vi.spyOn(window, "fetch").mockResolvedValue({
            ok: true,
            json: () =>
                Promise.resolve({
                    ok: true,
                    data: {
                        draft: {
                            source: {
                                id: 1,
                                projectId: "project-delayed-api",
                                timestamp: 1,
                                thumbnail: {
                                    contentType: "image/png",
                                    size: 9,
                                    data: btoa("thumbnail"),
                                },
                                width: 600,
                                height: 424,
                                layers: [
                                    {
                                        name: "Restored after readiness",
                                        isVisible: true,
                                        opacity: 1,
                                        mixModeStr: "source-over",
                                        blob: {
                                            contentType: "image/png",
                                            size: 5,
                                            data: btoa("layer"),
                                        },
                                    },
                                ],
                            },
                        },
                    },
                }),
        } as Response)
        let blankProject: FakeKlecksProject | undefined
        let restoredProject: unknown
        let embedReady = false
        mockScriptLoad()
        window.Klecks = class FakeKlecks {
            openStorageProject?: (project: unknown) => Promise<void>

            constructor() {
                setTimeout(() => {
                    this.openStorageProject = (
                        project: unknown,
                    ): Promise<void> => {
                        restoredProject = project
                        return Promise.resolve()
                    }
                    embedReady = true
                }, 0)
            }

            openProject(nextProject: FakeKlecksProject): void {
                blankProject = nextProject
            }

            getPNG(): Promise<Blob> {
                return Promise.resolve(new Blob())
            }
        }

        const host = document.createElement(TAG)
        host.dataset.embedSrc = "embed.js"
        host.dataset.draftApi = "/api/oekaki-drafts"
        document.body.appendChild(host)
        await waitUntil(() => embedReady)
        await new Promise((resolve) => setTimeout(resolve, 50))

        expect(restoredProject).toMatchObject({
            projectId: "project-delayed-api",
            width: 600,
            height: 424,
            layers: [{ name: "Restored after readiness" }],
        })
        expect(blankProject).toBeUndefined()
    })

    test("Klecks の復元 API が準備されなければ待機を終えて白紙を一度だけ開く", async () => {
        const saveKey = "a".repeat(64)
        localStorage.setItem(
            KLECKS_CLOUD_DRAFTS_STORAGE_KEY,
            JSON.stringify({
                saveKey,
                drafts: {
                    draft_missing_api: {
                        id: "draft_missing_api",
                        updated_at: "2026-07-10T00:00:00+00:00",
                    },
                },
            }),
        )
        Object.defineProperty(window, "opener", {
            configurable: true,
            value: {
                closed: false,
                dispatchEvent: vi.fn(),
            },
        })
        fetchSpy = vi.spyOn(window, "fetch").mockResolvedValue({
            ok: true,
            json: () =>
                Promise.resolve({
                    ok: true,
                    data: {
                        draft: {
                            source: {
                                id: 1,
                                projectId: "project-missing-api",
                                timestamp: 1,
                                thumbnail: {
                                    contentType: "image/png",
                                    size: 9,
                                    data: btoa("thumbnail"),
                                },
                                width: 600,
                                height: 424,
                                layers: [],
                            },
                        },
                    },
                }),
        } as Response)
        const blankProjects: FakeKlecksProject[] = []
        mockScriptLoad()
        window.Klecks = class FakeKlecks {
            openProject(nextProject: FakeKlecksProject): void {
                blankProjects.push(nextProject)
            }

            getPNG(): Promise<Blob> {
                return Promise.resolve(new Blob())
            }
        }
        vi.useFakeTimers()

        try {
            const host = document.createElement(TAG)
            host.dataset.embedSrc = "embed.js"
            host.dataset.draftApi = "/api/oekaki-drafts"
            document.body.appendChild(host)
            await vi.advanceTimersByTimeAsync(0)
            await flushMicrotasks()
            await vi.advanceTimersByTimeAsync(9_999)
            await flushMicrotasks()

            expect(blankProjects).toHaveLength(0)
            expect(vi.getTimerCount()).toBe(1)

            await vi.advanceTimersByTimeAsync(1)
            await flushMicrotasks()

            expect(blankProjects).toHaveLength(1)
            expect(blankProjects[0]).toMatchObject({
                width: 600,
                height: 424,
            })
            expect(vi.getTimerCount()).toBe(0)
        } finally {
            vi.useRealTimers()
        }
    })

    test("フォールバックのクラウド下書きタイマーを復元完了後に解除する", async () => {
        const saveKey = "e".repeat(64)
        localStorage.setItem(
            KLECKS_CLOUD_DRAFTS_STORAGE_KEY,
            JSON.stringify({
                saveKey,
                drafts: {
                    draft_fallback_timeout: {
                        id: "draft_fallback_timeout",
                        updated_at: "2026-07-08T00:00:00+00:00",
                    },
                },
            }),
        )
        Object.defineProperty(window, "opener", {
            configurable: true,
            value: {
                closed: false,
                dispatchEvent: vi.fn(),
            },
        })
        fetchSpy = vi.spyOn(window, "fetch").mockResolvedValue({
            ok: true,
            json: () =>
                Promise.resolve({
                    ok: true,
                    data: {
                        draft: {
                            source: {
                                id: 1,
                                projectId: "project-fallback-timeout",
                                timestamp: 1,
                                thumbnail: {
                                    contentType: "image/png",
                                    size: 9,
                                    data: btoa("thumbnail"),
                                },
                                width: 111,
                                height: 222,
                                layers: [],
                            },
                        },
                    },
                }),
        } as Response)
        let restoredProject: unknown
        mockScriptLoad()
        window.Klecks = class FakeKlecks {
            openProject(): void {
                return
            }

            getPNG(): Promise<Blob> {
                return Promise.resolve(new Blob())
            }

            openStorageProject(project: unknown): Promise<void> {
                restoredProject = project
                return Promise.resolve()
            }
        }

        const timeoutDescriptor = Object.getOwnPropertyDescriptor(
            AbortSignal,
            "timeout",
        )
        Object.defineProperty(AbortSignal, "timeout", {
            configurable: true,
            value: undefined,
        })
        vi.useFakeTimers()

        try {
            const host = document.createElement(TAG)
            host.dataset.embedSrc = "embed.js"
            host.dataset.draftApi = "/api/oekaki-drafts"
            document.body.appendChild(host)
            await vi.advanceTimersByTimeAsync(0)
            await flushMicrotasks()

            expect(fetchSpy).toHaveBeenCalledOnce()
            expect(restoredProject).toMatchObject({
                projectId: "project-fallback-timeout",
            })
            expect(vi.getTimerCount()).toBe(0)
        } finally {
            vi.useRealTimers()
            if (timeoutDescriptor) {
                Object.defineProperty(AbortSignal, "timeout", timeoutDescriptor)
            } else {
                delete (AbortSignal as { timeout?: unknown }).timeout
            }
        }
    })

    test("保存キーだけが残っている場合はクラウド下書き一覧から復元する", async () => {
        const saveKey = "d".repeat(64)
        localStorage.setItem(
            KLECKS_CLOUD_DRAFTS_STORAGE_KEY,
            JSON.stringify({
                saveKey,
                drafts: {},
            }),
        )
        Object.defineProperty(window, "opener", {
            configurable: true,
            value: {
                closed: false,
                dispatchEvent: vi.fn(),
            },
        })
        fetchSpy = vi.spyOn(window, "fetch").mockImplementation((input) => {
            const url = String(input)
            if (url === "/api/oekaki-drafts") {
                return Promise.resolve({
                    ok: true,
                    json: () =>
                        Promise.resolve({
                            ok: true,
                            data: {
                                drafts: [
                                    {
                                        id: "older_draft",
                                        updated_at: "2026-07-07T00:00:00+00:00",
                                    },
                                    {
                                        id: "draft_from_index",
                                        updated_at: "2026-07-08T00:00:00+00:00",
                                    },
                                ],
                            },
                        }),
                } as Response)
            }

            return Promise.resolve({
                ok: true,
                json: () =>
                    Promise.resolve({
                        ok: true,
                        data: {
                            draft: {
                                source: {
                                    id: 1,
                                    projectId: "project-from-index",
                                    timestamp: 1,
                                    thumbnail: {
                                        contentType: "image/png",
                                        size: 9,
                                        data: btoa("thumbnail"),
                                    },
                                    width: 222,
                                    height: 333,
                                    layers: [
                                        {
                                            name: "From index",
                                            isVisible: true,
                                            opacity: 1,
                                            mixModeStr: "source-over",
                                            blob: {
                                                contentType: "image/png",
                                                size: 5,
                                                data: btoa("layer"),
                                            },
                                        },
                                    ],
                                },
                            },
                        },
                    }),
            } as Response)
        })
        let restoredProject: unknown
        mockScriptLoad()
        window.Klecks = class FakeKlecks {
            openProject(): void {
                return
            }

            getPNG(): Promise<Blob> {
                return Promise.resolve(new Blob())
            }

            openStorageProject(project: unknown): Promise<void> {
                restoredProject = project
                return Promise.resolve()
            }
        }

        const host = document.createElement(TAG)
        host.dataset.embedSrc = "embed.js"
        host.dataset.draftApi = "/api/oekaki-drafts"
        document.body.appendChild(host)
        await waitUntil(() => restoredProject !== undefined)

        expect(fetchSpy).toHaveBeenCalledTimes(2)
        const [indexUrl, indexInit] = fetchSpy.mock.calls[0] ?? []
        const [draftUrl, draftInit] = fetchSpy.mock.calls[1] ?? []
        expect(indexUrl).toBe("/api/oekaki-drafts")
        expect(indexInit?.signal).toBeInstanceOf(AbortSignal)
        expect(
            (indexInit?.headers as Record<string, string>)["X-Oekaki-Save-Key"],
        ).toBe(saveKey)
        expect(draftUrl).toBe("/api/oekaki-drafts/draft_from_index")
        expect(draftInit?.signal).toBeInstanceOf(AbortSignal)
        expect(
            (draftInit?.headers as Record<string, string>)["X-Oekaki-Save-Key"],
        ).toBe(saveKey)
        expect(restoredProject).toMatchObject({
            projectId: "project-from-index",
            width: 222,
            height: 333,
            layers: [{ name: "From index" }],
        })
        expect(localStorage.getItem(KLECKS_CLOUD_DRAFTS_STORAGE_KEY)).toContain(
            "draft_from_index",
        )
    })

    function mockScriptLoad(): void {
        const append = document.head.appendChild.bind(document.head)
        appendSpy = vi
            .spyOn(document.head, "appendChild")
            .mockImplementation((node) => {
                const result = append(node)
                if (node instanceof HTMLScriptElement) {
                    setTimeout(() => {
                        node.onload?.(new Event("load"))
                    }, 0)
                }
                return result
            })
    }

    function mockPreviewWebpEncoding(data: string): void {
        vi.stubGlobal(
            "createImageBitmap",
            vi.fn(() =>
                Promise.resolve({
                    width: 1,
                    height: 1,
                    close: vi.fn(),
                }),
            ),
        )
        canvasContextSpy = vi
            .spyOn(HTMLCanvasElement.prototype, "getContext")
            .mockReturnValue({
                drawImage: vi.fn(),
            } as unknown as CanvasRenderingContext2D)
        canvasToBlobSpy = vi
            .spyOn(HTMLCanvasElement.prototype, "toBlob")
            .mockImplementation((callback, type) => {
                callback(new Blob([data], { type: type ?? "image/webp" }))
            })
    }
})
