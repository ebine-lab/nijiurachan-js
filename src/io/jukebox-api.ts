// src/io/jukebox-api.ts
import type { JukeboxHistory, JukeboxState } from "../pure/jukebox"

export interface JukeboxClientOptions {
  baseUrl: string
}

export class HttpError extends Error {
  status: number
  /** レスポンス body の `error` コード（あれば）。status だけでは区別できない 400 の細分に使う。 */
  code: string | null
  constructor(status: number, code: string | null = null) {
    super(`HTTP ${status}`)
    this.status = status
    this.code = code
  }
}

async function throwIfNotOk(res: Response): Promise<void> {
  if (res.ok) return
  let code: string | null = null
  try {
    const body = (await res.json()) as { error?: string }
    code = body?.error ?? null
  } catch {
    // body が JSON でない/空のときは code なし
  }
  throw new HttpError(res.status, code)
}

/** POST /api/skip/vote のレスポンス。voted=投票が記録された / removed=閾値超過で除外・スキップされた */
export interface JukeboxVoteResult {
  voted: boolean
  removed: boolean
}

export interface JukeboxClient {
  getState(): Promise<JukeboxState>
  /** 直近24hの再生履歴（GET /api/history）。 */
  getHistory(): Promise<JukeboxHistory>
  postPresence(): Promise<void>
  enqueue(url: string): Promise<void>
  /**
   * 予約キューから自分のトラックを削除する。
   * trackId 指定でそのトラック1曲だけ削除（所有者一致が必要）。
   * 省略時は自分の queued を全削除（後方互換）。
   */
  cancelMine(trackId?: number): Promise<void>
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

    async getHistory(): Promise<JukeboxHistory> {
      const res = await fetch(`${base}/api/history`, {
        method: "GET",
        credentials: "omit",
      })
      await throwIfNotOk(res)
      return res.json() as Promise<JukeboxHistory>
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

    async cancelMine(trackId?: number): Promise<void> {
      const qs =
        trackId !== undefined
          ? `?trackId=${encodeURIComponent(String(trackId))}`
          : ""
      const res = await fetch(`${base}/api/queue/mine${qs}`, {
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
