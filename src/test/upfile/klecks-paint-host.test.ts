import { afterEach, describe, expect, type Mock, test, vi } from "vitest"
import { KlecksPaintHostElement } from "#js/elements/klecks-paint-host"

type FakeKlecksOptions = ConstructorParameters<
    NonNullable<typeof window.Klecks>
>[0]
type FakeKlecksProject = Parameters<
    InstanceType<NonNullable<typeof window.Klecks>>["openProject"]
>[0]

const TAG = "klecks-paint-host-test"
if (!customElements.get(TAG)) {
    customElements.define(TAG, KlecksPaintHostElement)
}

const nextTask = (): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, 0))

describe(KlecksPaintHostElement, () => {
    let appendSpy: Mock<typeof document.head.appendChild> | undefined
    let alertSpy: Mock<typeof window.alert> | undefined
    let errorSpy: Mock<typeof console.error> | undefined

    afterEach(() => {
        appendSpy?.mockRestore()
        alertSpy?.mockRestore()
        errorSpy?.mockRestore()
        appendSpy = undefined
        alertSpy = undefined
        errorSpy = undefined
        window.Klecks = undefined
        window.onbeforeunload = null
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
})
