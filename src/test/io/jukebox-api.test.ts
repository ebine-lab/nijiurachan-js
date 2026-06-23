import { afterEach, describe, expect, it, vi } from "vitest"
import { createJukeboxClient } from "#js/io/jukebox-api"
import type { JukeboxState } from "#js/pure/jukebox"

const BASE = "https://music.nijiurachan.net"

function mockFetch(body: unknown, status = 200): void {
    vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
            ok: status >= 200 && status < 300,
            status,
            json: () => Promise.resolve(body),
        }),
    )
}

afterEach(() => {
    vi.unstubAllGlobals()
})

const exampleState: JukeboxState = {
    nowPlaying: {
        id: 1,
        source: "youtube",
        mediaId: "dQw4w9WgXcQ",
        title: "Test Song",
        durationSec: 212,
        mine: false,
        myVoted: false,
        startedAtMs: 1_700_000_000_000 - 30_000,
        isReplay: false,
    },
    serverNowMs: 1_700_000_000_000,
    queue: [],
    listeners: 1,
    mySkipVoted: false,
    enqueueCooldownRemainingSec: 0,
}

describe("getState", () => {
    it("calls GET /api/state and returns parsed state including enqueueCooldownRemainingSec and nowPlaying.isReplay", async () => {
        mockFetch(exampleState)
        const client = createJukeboxClient({ baseUrl: BASE })
        const state = await client.getState()
        expect(state).toEqual(exampleState)
        expect(state.enqueueCooldownRemainingSec).toBe(0)
        expect(state.nowPlaying?.isReplay).toBe(false)
        expect(vi.mocked(fetch)).toHaveBeenCalledWith(`${BASE}/api/state`, {
            method: "GET",
            credentials: "omit",
        })
    })

    it("throws with status on 500", async () => {
        mockFetch({}, 500)
        const client = createJukeboxClient({ baseUrl: BASE })
        await expect(client.getState()).rejects.toMatchObject({ status: 500 })
    })
})

describe("postPresence", () => {
    it("calls POST /api/presence with no body and resolves void", async () => {
        mockFetch({ ok: true })
        const client = createJukeboxClient({ baseUrl: BASE })
        await expect(client.postPresence()).resolves.toBeUndefined()
        expect(vi.mocked(fetch)).toHaveBeenCalledWith(`${BASE}/api/presence`, {
            method: "POST",
            credentials: "omit",
        })
    })

    it("throws with status on 429", async () => {
        mockFetch({}, 429)
        const client = createJukeboxClient({ baseUrl: BASE })
        await expect(client.postPresence()).rejects.toMatchObject({
            status: 429,
        })
    })
})

describe("enqueue", () => {
    it("calls POST /api/queue with JSON body and resolves on 201", async () => {
        mockFetch({ ok: true }, 201)
        const client = createJukeboxClient({ baseUrl: BASE })
        await expect(
            client.enqueue("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
        ).resolves.toBeUndefined()
        expect(vi.mocked(fetch)).toHaveBeenCalledWith(`${BASE}/api/queue`, {
            method: "POST",
            credentials: "omit",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            }),
        })
    })

    it("throws status 409 for already_queued", async () => {
        mockFetch({}, 409)
        const client = createJukeboxClient({ baseUrl: BASE })
        await expect(
            client.enqueue("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
        ).rejects.toMatchObject({ status: 409 })
    })

    it("throws status 415 for unsupported media", async () => {
        mockFetch({}, 415)
        const client = createJukeboxClient({ baseUrl: BASE })
        await expect(
            client.enqueue("https://vimeo.com/123"),
        ).rejects.toMatchObject({
            status: 415,
        })
    })

    it("throws status 429 for rate limit", async () => {
        mockFetch({}, 429)
        const client = createJukeboxClient({ baseUrl: BASE })
        await expect(
            client.enqueue("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
        ).rejects.toMatchObject({ status: 429 })
    })

    it("throws status 400 for bad request", async () => {
        mockFetch({}, 400)
        const client = createJukeboxClient({ baseUrl: BASE })
        await expect(client.enqueue("not-a-url")).rejects.toMatchObject({
            status: 400,
        })
    })

    it("throws status 403 for forbidden", async () => {
        mockFetch({}, 403)
        const client = createJukeboxClient({ baseUrl: BASE })
        await expect(
            client.enqueue("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
        ).rejects.toMatchObject({ status: 403 })
    })
})

describe("cancelMine", () => {
    it("calls DELETE /api/queue/mine and resolves void", async () => {
        mockFetch({ ok: true })
        const client = createJukeboxClient({ baseUrl: BASE })
        await expect(client.cancelMine()).resolves.toBeUndefined()
        expect(vi.mocked(fetch)).toHaveBeenCalledWith(
            `${BASE}/api/queue/mine`,
            {
                method: "DELETE",
                credentials: "omit",
            },
        )
    })

    it("throws status 404 when nothing to cancel", async () => {
        mockFetch({}, 404)
        const client = createJukeboxClient({ baseUrl: BASE })
        await expect(client.cancelMine()).rejects.toMatchObject({ status: 404 })
    })
})

describe("vote", () => {
    it("calls POST /api/skip/vote with { trackId } body and returns { voted: true, removed: false } when vote registered", async () => {
        mockFetch({ voted: true, removed: false })
        const client = createJukeboxClient({ baseUrl: BASE })
        const result = await client.vote(42)
        expect(result).toEqual({ voted: true, removed: false })
        expect(vi.mocked(fetch)).toHaveBeenCalledWith(`${BASE}/api/skip/vote`, {
            method: "POST",
            credentials: "omit",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ trackId: 42 }),
        })
    })

    it("returns { voted: false, removed: false } when vote toggled off (cancelled)", async () => {
        mockFetch({ voted: false, removed: false })
        const client = createJukeboxClient({ baseUrl: BASE })
        const result = await client.vote(42)
        expect(result).toEqual({ voted: false, removed: false })
    })

    it("returns { voted: true, removed: true } when threshold reached and track removed/skipped", async () => {
        mockFetch({ voted: true, removed: true })
        const client = createJukeboxClient({ baseUrl: BASE })
        const result = await client.vote(7)
        expect(result).toEqual({ voted: true, removed: true })
    })

    it("omitting trackId targets the playing track (sends empty body, back-compat)", async () => {
        mockFetch({ voted: true, removed: false })
        const client = createJukeboxClient({ baseUrl: BASE })
        const result = await client.vote()
        expect(result).toEqual({ voted: true, removed: false })
        expect(vi.mocked(fetch)).toHaveBeenCalledWith(`${BASE}/api/skip/vote`, {
            method: "POST",
            credentials: "omit",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
        })
    })

    it("throws status 429 on rate limit", async () => {
        mockFetch({}, 429)
        const client = createJukeboxClient({ baseUrl: BASE })
        await expect(client.vote(1)).rejects.toMatchObject({ status: 429 })
    })
})

describe("baseUrl trailing slash normalization", () => {
    it("末尾スラッシュ付き baseUrl でも正しい URL が生成される（// にならない）", async () => {
        mockFetch({
            nowPlaying: null,
            serverNowMs: 0,
            queue: [],
            listeners: 0,
            mySkipVoted: false,
            enqueueCooldownRemainingSec: 0,
        })
        const client = createJukeboxClient({
            baseUrl: "https://music.nijiurachan.net/",
        })
        await client.getState()
        expect(vi.mocked(fetch)).toHaveBeenCalledWith(
            "https://music.nijiurachan.net/api/state",
            expect.anything(),
        )
        // 二重スラッシュを含まないこと
        const calledUrl = String(
            (vi.mocked(fetch).mock.calls[0] as [string, unknown])[0],
        )
        expect(calledUrl).not.toContain("//api/")
    })

    it("末尾スラッシュなし baseUrl はそのまま正しい URL が生成される", async () => {
        mockFetch({
            nowPlaying: null,
            serverNowMs: 0,
            queue: [],
            listeners: 0,
            mySkipVoted: false,
            enqueueCooldownRemainingSec: 0,
        })
        const client = createJukeboxClient({
            baseUrl: "https://music.nijiurachan.net",
        })
        await client.getState()
        expect(vi.mocked(fetch)).toHaveBeenCalledWith(
            "https://music.nijiurachan.net/api/state",
            expect.anything(),
        )
    })
})
