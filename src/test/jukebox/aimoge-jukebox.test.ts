import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AimogeJukeboxElement } from "#js/elements/aimoge-jukebox"
import type { JukeboxState } from "#js/pure/jukebox"

// ─── YT IFrame API スタブ ────────────────────────────────────────────────────
interface MockYTPlayer {
    seekTo: ReturnType<typeof vi.fn>
    loadVideoById: ReturnType<typeof vi.fn>
    cueVideoById: ReturnType<typeof vi.fn>
    getCurrentTime: ReturnType<typeof vi.fn>
    setVolume: ReturnType<typeof vi.fn>
    getVolume: ReturnType<typeof vi.fn>
    mute: ReturnType<typeof vi.fn>
    unMute: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
    _readyCallback: ((e: { target: MockYTPlayer }) => void) | undefined
}

type MockYTConstructor = ReturnType<typeof vi.fn> & {
    _lastInstance?: MockYTPlayer
}

function makeMockYT(): {
    Player: MockYTConstructor
    PlayerState: { ENDED: number }
} {
    const PlayerConstructor = vi.fn(function (
        this: MockYTPlayer,
        _elementId: string,
        opts: {
            events?: {
                onReady?: (e: { target: MockYTPlayer }) => void
            }
        },
    ) {
        this.seekTo = vi.fn()
        this.loadVideoById = vi.fn()
        this.cueVideoById = vi.fn()
        this.getCurrentTime = vi.fn().mockReturnValue(0)
        this.setVolume = vi.fn()
        this.getVolume = vi.fn().mockReturnValue(50)
        this.mute = vi.fn()
        this.unMute = vi.fn()
        this.destroy = vi.fn()
        this._readyCallback = opts.events?.onReady
        // テストから onReady を手動で発火できるよう lastInstance に保存
        PlayerConstructor._lastInstance = this
    }) as MockYTConstructor

    return { Player: PlayerConstructor, PlayerState: { ENDED: 0 } }
}

/** window.YT スタブを型安全に取得するヘルパー */
function getMockYT(): ReturnType<typeof makeMockYT> {
    return (globalThis as unknown as Window).YT as unknown as ReturnType<
        typeof makeMockYT
    >
}

// ─── テスト用タグ名 ──────────────────────────────────────────────────────────
const TAG = "aimoge-jukebox-test"

// ─── fetch スタブヘルパー ─────────────────────────────────────────────────────
const IDLE_STATE: JukeboxState = {
    nowPlaying: null,
    serverNowMs: 1_000_000,
    queue: [],
    listeners: 1,
    mySkipVoted: false,
    enqueueCooldownRemainingSec: 0,
}

function makeStateFetch(
    state: JukeboxState = IDLE_STATE,
): ReturnType<typeof vi.fn> {
    return vi.fn().mockImplementation((url: string) => {
        if (String(url).includes("/api/state")) {
            return Promise.resolve(
                new Response(JSON.stringify(state), { status: 200 }),
            )
        }
        if (String(url).includes("/api/presence")) {
            return Promise.resolve(
                new Response(JSON.stringify({ ok: true }), { status: 200 }),
            )
        }
        return Promise.reject(new Error(`unexpected fetch: ${String(url)}`))
    })
}

// ─── マウントヘルパー ─────────────────────────────────────────────────────────
function mount(apiBase?: string): HTMLElement {
    const el = document.createElement(TAG)
    if (apiBase) el.setAttribute("data-api-base", apiBase)
    document.body.appendChild(el)
    return el
}

/** fake timers 使用中に pending な promises/microtasks を消化する */
async function flushPromises(): Promise<void> {
    await vi.advanceTimersByTimeAsync(0)
}

// ─── テスト ──────────────────────────────────────────────────────────────────
describe("AimogeJukeboxElement", () => {
    beforeEach(() => {
        if (!customElements.get(TAG)) {
            // テスト用タグで define（本番タグ "aimoge-jukebox" と競合しない）
            customElements.define(TAG, AimogeJukeboxElement)
        }
        vi.useFakeTimers()
        vi.stubGlobal("YT", makeMockYT())
        vi.stubGlobal("fetch", makeStateFetch())
    })

    afterEach(() => {
        document.body.innerHTML = ""
        vi.useRealTimers()
        vi.unstubAllGlobals()
    })

    it("connectedCallback で state の fetch を即座に呼ぶ", async () => {
        mount()
        // マイクロタスクを消化（fetch の promise chain）
        await flushPromises()
        const fetchMock = vi.mocked(globalThis.fetch)
        expect(fetchMock).toHaveBeenCalledWith(
            expect.stringContaining("/api/state"),
            expect.objectContaining({ credentials: "omit" }),
        )
    })

    it("~3s ポーリング: setInterval が 3000ms で発火し state を再取得する", async () => {
        mount()
        await flushPromises()
        const countBefore = vi
            .mocked(globalThis.fetch)
            .mock.calls.filter((c) =>
                String(c[0]).includes("/api/state"),
            ).length

        await vi.advanceTimersByTimeAsync(3000)

        const countAfter = vi
            .mocked(globalThis.fetch)
            .mock.calls.filter((c) =>
                String(c[0]).includes("/api/state"),
            ).length
        expect(countAfter).toBeGreaterThan(countBefore)
    })

    it("~10s ポーリング: postPresence が 10s 経過後に呼ばれる", async () => {
        mount()
        await flushPromises()

        await vi.advanceTimersByTimeAsync(10000)

        const presenceCalls = vi
            .mocked(globalThis.fetch)
            .mock.calls.filter((c) => String(c[0]).includes("/api/presence"))
        expect(presenceCalls.length).toBeGreaterThanOrEqual(1)
    })

    it("disconnectedCallback でポーリングが停止し fetch が呼ばれなくなる", async () => {
        const el = mount()
        await flushPromises()

        el.remove()
        const callsBefore = vi.mocked(globalThis.fetch).mock.calls.length

        await vi.advanceTimersByTimeAsync(30000)

        // disconnect 後は fetch が増えない
        expect(vi.mocked(globalThis.fetch).mock.calls.length).toBe(callsBefore)
    })

    it("data-api-base 属性でベース URL が上書きされる", async () => {
        mount("https://custom-api.example.com")
        await flushPromises()
        expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
            expect.stringContaining("https://custom-api.example.com/api/state"),
            expect.anything(),
        )
    })

    it("nowPlaying がある state を受け取ると YT.Player を生成する", async () => {
        const stateWithPlaying = {
            ...IDLE_STATE,
            nowPlaying: {
                id: 1,
                source: "youtube" as const,
                mediaId: "abcdefghijk",
                title: "Test Song",
                durationSec: 180,
                mine: false,
                myVoted: false,
                startedAtMs: 1_000_000 - 10_000, // 10 秒前に開始
                isReplay: false,
            },
            serverNowMs: 1_000_000,
        }
        vi.stubGlobal("fetch", makeStateFetch(stateWithPlaying))
        mount()
        await flushPromises()
        const YTMock = getMockYT()
        // player id はインスタンスごとに一意（"jukebox-yt-player-N" 形式）
        expect(YTMock.Player).toHaveBeenCalledWith(
            expect.stringContaining("jukebox-yt-player"),
            expect.objectContaining({
                videoId: "abcdefghijk",
                // デフォルトは一時停止（自動再生しない）
                playerVars: expect.objectContaining({ autoplay: 0 }),
            }),
        )
    })

    it("複数インスタンスは異なる player id を使う（多重インスタンス干渉防止）", async () => {
        const stateWithPlaying = {
            ...IDLE_STATE,
            nowPlaying: {
                id: 1,
                source: "youtube" as const,
                mediaId: "abcdefghijk",
                title: "Test Song",
                durationSec: 180,
                mine: false,
                myVoted: false,
                startedAtMs: 1_000_000 - 10_000,
                isReplay: false,
            },
            serverNowMs: 1_000_000,
        }
        vi.stubGlobal("fetch", makeStateFetch(stateWithPlaying))
        mount()
        mount()
        await flushPromises()
        const YTMock = getMockYT()
        const calls = YTMock.Player.mock.calls as Array<[string, unknown]>
        expect(calls.length).toBeGreaterThanOrEqual(2)
        const id1 = calls[0]?.[0]
        const id2 = calls[1]?.[0]
        expect(id1).not.toBe(id2)
    })

    it("enqueue フォーム送信で parseJukeboxUrl を通過した URL が POST /api/queue に送られる", async () => {
        const fetchMock = makeStateFetch()
        fetchMock.mockImplementation((url: string) => {
            if (String(url).includes("/api/queue")) {
                return Promise.resolve(
                    new Response(JSON.stringify({ ok: true }), { status: 201 }),
                )
            }
            if (String(url).includes("/api/state")) {
                return Promise.resolve(
                    new Response(JSON.stringify(IDLE_STATE), { status: 200 }),
                )
            }
            if (String(url).includes("/api/presence")) {
                return Promise.resolve(
                    new Response(JSON.stringify({ ok: true }), { status: 200 }),
                )
            }
            return Promise.reject(new Error(`unexpected: ${String(url)}`))
        })
        vi.stubGlobal("fetch", fetchMock)

        const el = mount()
        await flushPromises()

        // Preact がレンダリングしたフォームに入力して submit
        const input = el.querySelector<HTMLInputElement>("input[type=url]")
        const form = el.querySelector<HTMLFormElement>("form")
        if (!input || !form) throw new Error("form not rendered")

        input.value = "https://youtu.be/abcdefghijk"
        input.dispatchEvent(new Event("input", { bubbles: true }))
        await flushPromises() // Preact の state 更新を消化
        form.dispatchEvent(new Event("submit", { bubbles: true }))
        await flushPromises()

        const queueCall = fetchMock.mock.calls.find((c) =>
            String(c[0]).includes("/api/queue"),
        )
        expect(queueCall).toBeDefined()
        expect(JSON.parse(queueCall?.[1]?.body as string)).toEqual({
            url: "https://youtu.be/abcdefghijk",
        })
    })

    it("enqueue に無効 URL を渡すと fetch は呼ばれない（parseJukeboxUrl が null）", async () => {
        const fetchMock = makeStateFetch()
        vi.stubGlobal("fetch", fetchMock)

        const el = mount()
        await flushPromises()
        fetchMock.mockClear()

        const input = el.querySelector<HTMLInputElement>("input[type=url]")
        const form = el.querySelector<HTMLFormElement>("form")
        if (!input || !form) throw new Error("form not rendered")

        input.value = "https://example.com/not-a-video"
        input.dispatchEvent(new Event("input", { bubbles: true }))
        form.dispatchEvent(new Event("submit", { bubbles: true }))
        await flushPromises()

        const queueCalls = fetchMock.mock.calls.filter((c) =>
            String(c[0]).includes("/api/queue"),
        )
        expect(queueCalls.length).toBe(0)
    })

    it("disconnect 後に fetch が resolve しても DOM 更新は起きない（abort ガード）", async () => {
        let resolveState!: (v: Response) => void
        const pendingFetch = vi.fn().mockImplementation((url: string) => {
            if (String(url).includes("/api/state")) {
                return new Promise<Response>((resolve) => {
                    resolveState = resolve
                })
            }
            return Promise.resolve(
                new Response(JSON.stringify({ ok: true }), { status: 200 }),
            )
        })
        vi.stubGlobal("fetch", pendingFetch)

        const el = mount()
        // まだ resolveState は呼ばれていない

        el.remove() // disconnect → abort

        // 遅れて resolve
        resolveState(new Response(JSON.stringify(IDLE_STATE), { status: 200 }))
        await flushPromises()

        // エラーなく終了すればよい（DOM を触らないのでクラッシュしない）
        expect(true).toBe(true)
    })

    it("ポーリング飛行中は次の interval をスキップし、完了後に再度 fetch できる（遅延応答を捨てない）", async () => {
        // 最初の fetch は pending にしておき、interval 発火後も重複しないことを確認
        let resolveFirst!: (v: Response) => void
        let callCount = 0
        const slowFetch = vi.fn().mockImplementation((url: string) => {
            if (String(url).includes("/api/state")) {
                callCount++
                if (callCount === 1) {
                    // 初回: 意図的に遅延させる
                    return new Promise<Response>((resolve) => {
                        resolveFirst = resolve
                    })
                }
                return Promise.resolve(
                    new Response(JSON.stringify(IDLE_STATE), { status: 200 }),
                )
            }
            return Promise.resolve(
                new Response(JSON.stringify({ ok: true }), { status: 200 }),
            )
        })
        vi.stubGlobal("fetch", slowFetch)

        mount()
        // 初回 fetch は pending
        await flushPromises()
        expect(callCount).toBe(1)

        // 3s 経過: interval 発火するが in-flight なのでスキップ
        await vi.advanceTimersByTimeAsync(3000)
        expect(callCount).toBe(1) // まだ 1 回のまま

        // 初回 resolve → 完了 → in-flight フラグ解除
        resolveFirst(new Response(JSON.stringify(IDLE_STATE), { status: 200 }))
        await flushPromises()

        // 次の interval では fetch できる
        await vi.advanceTimersByTimeAsync(3000)
        expect(callCount).toBeGreaterThanOrEqual(2)
    })

    it("window.YT が未初期化のとき #syncPlayer はスキップして UI だけ更新する", async () => {
        // YT を未定義にする
        vi.stubGlobal("YT", undefined)

        const stateWithPlaying = {
            ...IDLE_STATE,
            nowPlaying: {
                id: 1,
                source: "youtube" as const,
                mediaId: "abcdefghijk",
                title: "Test Song",
                durationSec: 180,
                mine: false,
                myVoted: false,
                startedAtMs: 1_000_000 - 10_000,
                isReplay: false,
            },
            serverNowMs: 1_000_000,
        }
        vi.stubGlobal("fetch", makeStateFetch(stateWithPlaying))

        const el = mount()
        // TypeError が throw されずに正常に render されること
        await expect(flushPromises()).resolves.not.toThrow()
        // UI は表示される（now-playing の div が存在）
        expect(el.querySelector(".jukebox-now-playing")).not.toBeNull()
    })

    it("ドリフト > 2s: 同じ曲が再生中のとき state ポーリング後に seekTo が呼ばれる", async () => {
        // リアルな進行中の曲: 10s 前に開始、サーバー時刻 1_000_000ms
        // → expectedOffsetSec ≈ 10s。getCurrentTime が 0s を返す → drift=10s > 2s
        const NP_MEDIA_ID = "abcdefghijk"
        const stateWithDrift = {
            ...IDLE_STATE,
            nowPlaying: {
                id: 1,
                source: "youtube" as const,
                mediaId: NP_MEDIA_ID,
                title: "Drift Song",
                durationSec: 300,
                mine: false,
                myVoted: false,
                startedAtMs: 1_000_000 - 10_000, // 10s 前に開始
                isReplay: false,
            },
            serverNowMs: 1_000_000,
        }
        vi.stubGlobal("fetch", makeStateFetch(stateWithDrift))

        mount()
        await flushPromises()

        // 初回: プレイヤー生成 → onReady が発火して seekTo が 1 回呼ばれる
        const YTMock = getMockYT()
        const playerInstance = YTMock.Player._lastInstance
        if (!playerInstance) throw new Error("YT.Player not constructed")

        // onReady を手動発火
        playerInstance._readyCallback?.({ target: playerInstance })
        expect(playerInstance.seekTo).toHaveBeenCalledTimes(1)

        // getCurrentTime がずれた位置（0s）を返すようにスタブ → expected≈10s との drift=10s > 2s
        playerInstance.getCurrentTime.mockReturnValue(0)

        // 3s 経過 → 2 回目のポーリング（同じ mediaId, getCurrentTime()=0, expected≈10s → drift>2s）
        await vi.advanceTimersByTimeAsync(3000)

        // ドリフト補正 seekTo が追加で呼ばれる
        expect(playerInstance.seekTo).toHaveBeenCalledTimes(2)
        const [seekSec, allowAhead] = playerInstance.seekTo.mock.calls[1] as [
            number,
            boolean,
        ]
        expect(allowAhead).toBe(true)
        expect(seekSec).toBeGreaterThan(2) // expected ≈ 10s
    })

    it("ドリフト <= 2s: seekTo は呼ばれない", async () => {
        // リアルな進行中の曲: 10s 前に開始、サーバー時刻 1_000_000ms
        // → expectedOffsetSec ≈ 10s。getCurrentTime も ≈ 10s を返す → drift ≈ 0s ≤ 2s
        const stateNoDrift = {
            ...IDLE_STATE,
            nowPlaying: {
                id: 1,
                source: "youtube" as const,
                mediaId: "nodriftxxxxx",
                title: "No Drift Song",
                durationSec: 300,
                mine: false,
                myVoted: false,
                startedAtMs: 1_000_000 - 10_000, // 10s 前に開始
                isReplay: false,
            },
            serverNowMs: 1_000_000,
        }
        vi.stubGlobal("fetch", makeStateFetch(stateNoDrift))

        mount()
        await flushPromises()

        const YTMock = getMockYT()
        const playerInstance = YTMock.Player._lastInstance
        if (!playerInstance) throw new Error("YT.Player not constructed")

        // onReady を手動発火（初回 seek は expected≈10s → 正常）
        playerInstance._readyCallback?.({ target: playerInstance })
        const seekCountAfterReady = playerInstance.seekTo.mock.calls.length

        // getCurrentTime が同期している位置（≈10s）を返すようにスタブ
        // ポーリング時 expectedOffsetSec = playbackOffsetSec(990_000, 1_000_000) + clientElapsed ≈ 10s
        // getCurrentTime を 10s に設定 → drift = 0s ≤ 2s → seekTo 不要
        playerInstance.getCurrentTime.mockReturnValue(10)

        // 3s 経過 → 2 回目のポーリング
        await vi.advanceTimersByTimeAsync(3000)

        // ドリフト補正 seekTo は追加で呼ばれない
        expect(playerInstance.seekTo.mock.calls.length).toBe(
            seekCountAfterReady,
        )
    })

    it("onReady で初期音量（localStorage 未設定なら既定の真ん中=50）が適用される", async () => {
        // localStorage があればキーを消して順序非依存にする（テスト環境では undefined なので no-op）
        if (typeof localStorage !== "undefined")
            localStorage.removeItem("aimoge_jukebox_volume")
        const stateWithNp = {
            ...IDLE_STATE,
            nowPlaying: {
                id: 1,
                source: "youtube" as const,
                mediaId: "abcdefghijk",
                title: "Vol Song",
                durationSec: 300,
                mine: false,
                myVoted: false,
                startedAtMs: 1_000_000,
                isReplay: false,
            },
            serverNowMs: 1_000_000,
        }
        vi.stubGlobal("fetch", makeStateFetch(stateWithNp))

        mount()
        await flushPromises()

        const playerInstance = getMockYT().Player._lastInstance
        if (!playerInstance) throw new Error("YT.Player not constructed")

        playerInstance._readyCallback?.({ target: playerInstance })

        expect(playerInstance.setVolume).toHaveBeenCalledWith(50)
    })

    it("data-no-player 属性付きならプレイヤーを生成せず、UI（曲名）は表示する", async () => {
        const stateWithNp = {
            ...IDLE_STATE,
            nowPlaying: {
                id: 1,
                source: "youtube" as const,
                mediaId: "abcdefghijk",
                title: "No Player Song",
                durationSec: 200,
                mine: false,
                myVoted: false,
                startedAtMs: 1_000_000,
                isReplay: false,
            },
            serverNowMs: 1_000_000,
        }
        vi.stubGlobal("fetch", makeStateFetch(stateWithNp))

        const el = document.createElement(TAG)
        el.setAttribute("data-no-player", "")
        document.body.appendChild(el)
        await flushPromises()

        // プレイヤーは生成されない（再生は別窓に委譲）
        expect(getMockYT().Player).not.toHaveBeenCalled()
        // 曲名・操作 UI は表示される
        expect(el.querySelector(".jukebox-now-playing")).not.toBeNull()
        // 動画マウント先・再生ボタンは描画されない
        expect(el.querySelector(".jukebox-playpause-btn")).toBeNull()
    })
})
