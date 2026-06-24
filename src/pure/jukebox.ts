// src/pure/jukebox.ts

export type JukeboxSource = "youtube" | "soundcloud"

export interface JukeboxQueueItem {
    /** トラックの一意 ID。除外投票（POST /api/skip/vote）の対象指定に使う */
    id: number
    source: JukeboxSource
    mediaId: string
    title: string | null
    durationSec: number
    mine: boolean
    /** 呼び出し元がこのトラックに除外投票済みか（永続化された投票状態） */
    myVoted: boolean
}

export interface JukeboxNowPlaying extends JukeboxQueueItem {
    startedAtMs: number
    isReplay: boolean
}

export interface JukeboxState {
    nowPlaying: JukeboxNowPlaying | null
    serverNowMs: number
    queue: JukeboxQueueItem[]
    listeners: number
    mySkipVoted: boolean
    enqueueCooldownRemainingSec: number
}

/** 再生履歴の1曲（直近24h、再生し終えた曲）。 */
export interface JukeboxHistoryItem {
    id: number
    source: JukeboxSource
    mediaId: string
    title: string | null
    durationSec: number
    /** この曲の再生を開始した時刻(epoch ms)。履歴の開始時刻表示に使う。 */
    startedAtMs: number
    endedAtMs: number
}

export interface JukeboxHistory {
    history: JukeboxHistoryItem[]
    serverNowMs: number
}

export interface ParsedJukeboxMedia {
    source: JukeboxSource
    mediaId: string
}

const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/

function parseYouTube(url: URL): ParsedJukeboxMedia | null {
    const host = url.hostname.replace(/^www\./, "")
    if (host !== "youtube.com") return null
    if (url.pathname !== "/watch") return null
    const v = url.searchParams.get("v")
    if (!v || !YT_ID_RE.test(v)) return null
    return { source: "youtube", mediaId: v }
}

function parseYouTubeShort(url: URL): ParsedJukeboxMedia | null {
    const host = url.hostname.replace(/^www\./, "")

    // youtu.be/<ID>
    if (host === "youtu.be") {
        const id = url.pathname.slice(1) // remove leading /
        if (!YT_ID_RE.test(id)) return null
        return { source: "youtube", mediaId: id }
    }

    // youtube.com/shorts/<ID>
    if (host === "youtube.com") {
        const match = url.pathname.match(/^\/shorts\/([A-Za-z0-9_-]{11})$/)
        if (!match) return null
        return { source: "youtube", mediaId: match[1] as string }
    }

    return null
}

export function parseJukeboxUrl(rawUrl: string): ParsedJukeboxMedia | null {
    let url: URL
    try {
        url = new URL(rawUrl)
    } catch {
        return null
    }
    // SoundCloud 対応は廃止。YouTube（watch / youtu.be / shorts）のみ。
    return parseYouTube(url) ?? parseYouTubeShort(url)
}

export function playbackOffsetSec(
    startedAtMs: number,
    serverNowMs: number,
): number {
    return Math.max(0, (serverNowMs - startedAtMs) / 1000)
}

/**
 * 予約キュー各曲が再生開始される「目安の絶対時刻(epoch ms, サーバー基準)」を返す。
 * 返り値[i] は queue[i] の開始予定時刻。曲尺の単純な積み上げによる推定で、
 * 途中スキップ等で前倒しになりうる（あくまで目安）。
 *
 * - 基準(base): 現在の曲が終わる時刻。再生中が無ければ serverNow。
 *   現曲が既に予定終了を過ぎている（advance 待ち）場合は serverNow にクランプし、
 *   「次の曲は今すぐ開始」とみなす。
 * - 絶対 epoch を返すのは表示が描画ごとにブレないため（相対値だと時間経過で目標時刻が
 *   ずれて見える）。サーバー↔クライアントの時計差ぶんの定常誤差は目安として許容する。
 */
export function computeQueueEtaMs(
    nowPlaying: { startedAtMs: number; durationSec: number } | null,
    queue: readonly { durationSec: number }[],
    serverNowMs: number,
): number[] {
    const base =
        nowPlaying != null
            ? Math.max(
                  serverNowMs,
                  nowPlaying.startedAtMs + nowPlaying.durationSec * 1000,
              )
            : serverNowMs
    const etas: number[] = []
    let acc = base
    for (const item of queue) {
        etas.push(acc)
        acc += item.durationSec * 1000
    }
    return etas
}

/** epoch ms をローカルタイムの "HH:mm"（24時間・ゼロ埋め）に整形する。
 *  不正値（NaN/undefined/Infinity 等。旧 API で startedAtMs 欠損のケース）は
 *  "NaN:NaN" を出さず "--:--" にフォールバックする。 */
export function formatClockTime(epochMs: number): string {
    if (!Number.isFinite(epochMs)) return "--:--"
    const d = new Date(epochMs)
    const hh = String(d.getHours()).padStart(2, "0")
    const mm = String(d.getMinutes()).padStart(2, "0")
    return `${hh}:${mm}`
}
