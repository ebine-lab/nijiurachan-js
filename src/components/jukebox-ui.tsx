/** @jsxImportSource preact */
import type { VNode } from "preact"
import { useState } from "preact/hooks"
import type { JukeboxQueueItem, JukeboxState } from "../pure/jukebox"

export interface JukeboxUIProps {
    state: JukeboxState | null
    onEnqueue: (url: string) => Promise<void>
    /** 指定トラックの除外投票をトグルする（再生中・キュー共通） */
    onVote: (trackId: number) => Promise<void>
    onCancelMine: () => Promise<void>
    /** 再生/一時停止トグル（YT プレイヤーを直接操作） */
    onTogglePlay: () => void
    /** YT プレイヤーが再生中か（ボタン表示の切替に使う） */
    isPlaying: boolean
    enqueueError: string | null
    /** YouTube プレイヤーをマウントする div の id。インスタンスごとに一意にする */
    playerId: string
}

/**
 * 除外投票ボタン。再生中・キューの各トラックに共通で使う。
 * myVoted で投票済み表示をトグルし、`is-voted` クラス + aria-pressed をホスト CSS 用に出す。
 */
function VoteButton(props: {
    trackId: number
    myVoted: boolean
    onVote: (trackId: number) => Promise<void>
}): VNode {
    const { trackId, myVoted, onVote } = props
    // 投票はトグルなので、リクエスト飛行中は無効化して連打による多重トグルを防ぐ
    const [submitting, setSubmitting] = useState(false)
    async function handleClick(): Promise<void> {
        if (submitting) return
        setSubmitting(true)
        try {
            await onVote(trackId)
        } finally {
            setSubmitting(false)
        }
    }
    return (
        <button
            type="button"
            class={`jukebox-vote-btn${myVoted ? " is-voted" : ""}`}
            aria-pressed={myVoted}
            disabled={submitting}
            onClick={() => void handleClick()}
        >
            {myVoted ? "投票済み(取消)" : "除外投票"}
        </button>
    )
}

/** state.enqueueCooldownRemainingSec を "N分S秒" 形式に変換する */
function formatCooldown(sec: number): string {
    const minutes = Math.floor(sec / 60)
    const secs = sec % 60
    return minutes > 0 ? `${minutes}分${secs}秒` : `${secs}秒`
}

export function JukeboxUI(props: JukeboxUIProps): VNode {
    const {
        state,
        onEnqueue,
        onVote,
        onCancelMine,
        onTogglePlay,
        isPlaying,
        enqueueError,
        playerId,
    } = props
    const [urlInput, setUrlInput] = useState("")
    const [submitting, setSubmitting] = useState(false)

    const cooldownSec = state?.enqueueCooldownRemainingSec ?? 0
    const onCooldown = cooldownSec > 0

    async function handleEnqueue(e: Event): Promise<void> {
        e.preventDefault()
        if (!urlInput.trim() || submitting || onCooldown) return
        setSubmitting(true)
        try {
            await onEnqueue(urlInput.trim())
            setUrlInput("")
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <div class="jukebox">
            <div class="jukebox-now-playing">
                {state?.nowPlaying ? (
                    <>
                        <strong>再生中:</strong>{" "}
                        {state.nowPlaying.title ?? state.nowPlaying.mediaId}
                        {state.nowPlaying.isReplay && (
                            <span
                                class="jukebox-replay-badge"
                                role="img"
                                aria-label="ラジオ自動再生"
                            >
                                ♻️ ラジオ（自動再生）
                            </span>
                        )}
                        <VoteButton
                            trackId={state.nowPlaying.id}
                            myVoted={state.nowPlaying.myVoted}
                            onVote={onVote}
                        />
                    </>
                ) : (
                    <span>再生なし</span>
                )}
            </div>

            <div class="jukebox-listeners">
                {state != null ? `${state.listeners}人が聴いています` : ""}
            </div>

            {/* YouTube IFrame がマウントされる要素。id はインスタンスごとに一意 */}
            <div id={playerId} />

            {/* 独立した再生/一時停止ボタン（native コントロールとは別にメニューに置く） */}
            <div class="jukebox-controls">
                <button
                    type="button"
                    class="jukebox-playpause-btn"
                    onClick={() => onTogglePlay()}
                    disabled={state?.nowPlaying == null}
                    aria-label={isPlaying ? "一時停止" : "再生"}
                >
                    {isPlaying ? "⏸ 一時停止" : "▶ 再生"}
                </button>
            </div>

            <ul class="jukebox-queue">
                {state?.queue.map((item: JukeboxQueueItem, index: number) => (
                    <li key={`${index}-${item.source}:${item.mediaId}`}>
                        {item.title ?? item.mediaId}
                        <VoteButton
                            trackId={item.id}
                            myVoted={item.myVoted}
                            onVote={onVote}
                        />
                        {item.mine && (
                            <button
                                type="button"
                                class="jukebox-cancel-btn"
                                onClick={() => void onCancelMine()}
                            >
                                キャンセル
                            </button>
                        )}
                    </li>
                ))}
            </ul>

            <form
                class="jukebox-enqueue-form"
                onSubmit={(e) => void handleEnqueue(e)}
            >
                <input
                    type="url"
                    value={urlInput}
                    placeholder="YouTube または SoundCloud の URL を入力"
                    onInput={(e) =>
                        setUrlInput((e.target as HTMLInputElement).value)
                    }
                    disabled={submitting || onCooldown}
                />
                <button
                    type="submit"
                    disabled={submitting || onCooldown || !urlInput.trim()}
                >
                    {submitting ? "追加中..." : "キューに追加"}
                </button>
                {onCooldown && (
                    <span class="jukebox-cooldown-label" aria-live="polite">
                        あと {formatCooldown(cooldownSec)} で追加できます
                    </span>
                )}
            </form>

            {enqueueError != null && (
                <div class="jukebox-error" role="alert">
                    {enqueueError}
                </div>
            )}
        </div>
    )
}

/** HttpError.status を日本語メッセージに変換する（enqueue 用） */
export function enqueueErrorMessage(status: number): string {
    if (status === 403) return "追加は書き込んだユーザーのみ可能です"
    if (status === 409) return "既に1曲追加済みです（再生後にまた追加できます）"
    if (status === 415) return "対応していない URL です"
    if (status === 429) return "30分に1曲までです。時間をおいて試してください"
    return `エラーが発生しました（HTTP ${status}）`
}
