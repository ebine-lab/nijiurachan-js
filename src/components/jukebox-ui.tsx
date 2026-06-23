/** @jsxImportSource preact */
import type { VNode } from "preact"
import { useState } from "preact/hooks"
import type { JukeboxQueueItem, JukeboxState } from "#js/pure/jukebox"

export interface JukeboxUIProps {
    state: JukeboxState | null
    onEnqueue: (url: string) => Promise<void>
    onSkipVote: () => Promise<void>
    onCancelMine: () => Promise<void>
    enqueueError: string | null
    /** YouTube プレイヤーをマウントする div の id。インスタンスごとに一意にする */
    playerId: string
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
        onSkipVote,
        onCancelMine,
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
                        <button
                            type="button"
                            class="jukebox-skip-btn"
                            disabled={state.mySkipVoted}
                            onClick={() => void onSkipVote()}
                        >
                            {state.mySkipVoted
                                ? "スキップ投票済み"
                                : "スキップ投票"}
                        </button>
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

            <ul class="jukebox-queue">
                {state?.queue.map((item: JukeboxQueueItem, index: number) => (
                    <li key={`${index}-${item.source}:${item.mediaId}`}>
                        {item.title ?? item.mediaId}
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
