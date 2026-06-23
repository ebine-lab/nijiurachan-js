// src/io/jukebox-api.ts
import type { JukeboxState } from "../pure/jukebox"

export interface JukeboxClientOptions {
    baseUrl: string
}

export class HttpError extends Error {
    status: number
    constructor(status: number) {
        super(`HTTP ${status}`)
        this.status = status
    }
}

async function throwIfNotOk(res: Response): Promise<void> {
    if (!res.ok) throw new HttpError(res.status)
}

/** POST /api/skip/vote のレスポンス。voted=投票が記録された / removed=閾値超過で除外・スキップされた */
export interface JukeboxVoteResult {
    voted: boolean
    removed: boolean
}

export interface JukeboxClient {
    getState(): Promise<JukeboxState>
    postPresence(): Promise<void>
    enqueue(url: string): Promise<void>
    cancelMine(): Promise<void>
    /**
     * 指定トラックの除外投票をトグルする（再度押すと取消）。
     * trackId を省略すると再生中トラックを対象にする（後方互換）。
     */
    vote(trackId?: number): Promise<JukeboxVoteResult>
}

export function createJukeboxClient({
    baseUrl,
}: JukeboxClientOptions): JukeboxClient {
    // 末尾スラッシュを除去して //api/... になる URL パターンを防ぐ
    const base = baseUrl.replace(/\/+$/, "")
    return {
        async getState(): Promise<JukeboxState> {
            const res = await fetch(`${base}/api/state`, {
                method: "GET",
                credentials: "omit",
            })
            await throwIfNotOk(res)
            return res.json() as Promise<JukeboxState>
        },

        async postPresence(): Promise<void> {
            const res = await fetch(`${base}/api/presence`, {
                method: "POST",
                credentials: "omit",
            })
            await throwIfNotOk(res)
        },

        async enqueue(url: string): Promise<void> {
            const res = await fetch(`${base}/api/queue`, {
                method: "POST",
                credentials: "omit",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url }),
            })
            await throwIfNotOk(res)
        },

        async cancelMine(): Promise<void> {
            const res = await fetch(`${base}/api/queue/mine`, {
                method: "DELETE",
                credentials: "omit",
            })
            await throwIfNotOk(res)
        },

        async vote(trackId?: number): Promise<JukeboxVoteResult> {
            const res = await fetch(`${base}/api/skip/vote`, {
                method: "POST",
                credentials: "omit",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(trackId === undefined ? {} : { trackId }),
            })
            await throwIfNotOk(res)
            return res.json() as Promise<JukeboxVoteResult>
        },
    }
}
