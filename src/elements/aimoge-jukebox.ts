import { h, render } from "preact"
import { enqueueErrorMessage, JukeboxUI } from "../components/jukebox-ui"
import type { JukeboxClient } from "../io/jukebox-api"
import { createJukeboxClient } from "../io/jukebox-api"
import type { JukeboxState } from "../pure/jukebox"
import { parseJukeboxUrl, playbackOffsetSec } from "../pure/jukebox"

// ─── YouTube IFrame Player API ambient types ──────────────────────────────────
interface YTPlayer {
    seekTo(sec: number, allowSeekAhead: boolean): void
    loadVideoById(videoId: string, startSeconds?: number): void
    getCurrentTime(): number
    playVideo(): void
    pauseVideo(): void
    destroy(): void
}

interface YTPlayerEvent {
    target: YTPlayer
}

declare global {
    interface Window {
        YT: {
            Player: new (
                elementId: string,
                opts: {
                    videoId: string
                    playerVars?: Record<string, unknown>
                    events?: {
                        onReady?: (e: YTPlayerEvent) => void
                        onStateChange?: (e: { data: number }) => void
                    }
                },
            ) => YTPlayer
            PlayerState: { ENDED: number; PLAYING: number; PAUSED: number }
        }
        onYouTubeIframeAPIReady?: () => void
    }
}
// ─────────────────────────────────────────────────────────────────────────────

const STATE_INTERVAL_MS = 3_000
const PRESENCE_INTERVAL_MS = 10_000
const DRIFT_THRESHOLD_SEC = 2
const DEFAULT_BASE_URL = "https://music.nijiurachan.net"

/** インスタンスごとに一意な player element id を生成するカウンタ */
let instanceCounter = 0

/**
 * あいもげジュークボックス custom element。
 * `data-api-base` 属性でバックエンドの base URL を指定できる（省略時は DEFAULT_BASE_URL）。
 *
 * 登録: `AimogeJukeboxElement.define()`
 */
export class AimogeJukeboxElement extends HTMLElement {
    #client: JukeboxClient | null = null
    #stateTimer: ReturnType<typeof setInterval> | null = null
    #presenceTimer: ReturnType<typeof setInterval> | null = null
    /** 現在飛行中のポーリングリクエストの AbortController。null なら空き */
    #abortController: AbortController | null = null
    #state: JukeboxState | null = null
    #enqueueError: string | null = null
    #ytPlayer: YTPlayer | null = null
    #currentMediaId: string | null = null
    #fetchedAtClientMs: number = 0
    /** YT プレイヤーが再生中か（onStateChange で更新し、再生/一時停止ボタンに反映） */
    #isPlaying: boolean = false
    /** このインスタンス専用の YouTube player mount point id */
    readonly #playerId: string

    constructor() {
        super()
        this.#playerId = `jukebox-yt-player-${++instanceCounter}`
    }

    static define(): void {
        customElements.define("aimoge-jukebox", AimogeJukeboxElement)
    }

    connectedCallback(): void {
        const baseUrl =
            this.getAttribute("data-api-base")?.trim() || DEFAULT_BASE_URL
        this.#client = createJukeboxClient({ baseUrl })

        // 初回レンダー: プレイヤーマウント先 div を DOM に配置してから同期する
        this.#renderUI()
        void this.#pollState()
        this.#stateTimer = setInterval(
            () => void this.#pollState(),
            STATE_INTERVAL_MS,
        )
        this.#presenceTimer = setInterval(
            () => void this.#sendPresence(),
            PRESENCE_INTERVAL_MS,
        )
    }

    disconnectedCallback(): void {
        if (this.#stateTimer !== null) {
            clearInterval(this.#stateTimer)
            this.#stateTimer = null
        }
        if (this.#presenceTimer !== null) {
            clearInterval(this.#presenceTimer)
            this.#presenceTimer = null
        }
        this.#abortController?.abort()
        this.#abortController = null
        this.#ytPlayer?.destroy()
        this.#ytPlayer = null
        this.#currentMediaId = null
        render(null, this)
    }

    async #pollState(): Promise<void> {
        // 既にリクエストが飛行中なら重複ポーリングをスキップ（遅延応答を捨てない）
        if (this.#abortController !== null) return

        const controller = new AbortController()
        this.#abortController = controller

        try {
            const fetchedAt = Date.now()
            const state = await this.#client?.getState()
            // disconnect 後に resolve した場合は無視
            if (controller.signal.aborted) return
            this.#fetchedAtClientMs = fetchedAt
            this.#state = state ?? null
            this.#enqueueError = null
            // UI を先にレンダーして player mount point を DOM に確実に存在させる
            this.#renderUI()
            if (state != null) {
                this.#syncPlayer(state)
            }
        } catch {
            if (!controller.signal.aborted) {
                // ネットワークエラー: 既存 UI は維持したまま次のポーリングを待つ
            }
        } finally {
            // 飛行中フラグを解除（次のインターバルポーリングを許可）
            if (this.#abortController === controller) {
                this.#abortController = null
            }
        }
    }

    async #sendPresence(): Promise<void> {
        if (!this.#client) return
        try {
            await this.#client.postPresence()
        } catch {
            // presence の失敗はサイレントに無視する
        }
    }

    #syncPlayer(state: JukeboxState): void {
        const np = state.nowPlaying
        if (!np || np.source !== "youtube") {
            if (this.#ytPlayer) {
                this.#ytPlayer.destroy()
                this.#ytPlayer = null
                this.#currentMediaId = null
            }
            return
        }

        // window.YT が未ロードの場合はスキップ（次のポーリングで再試行）
        if (typeof window.YT?.Player !== "function") return

        const clientElapsedMs = Date.now() - this.#fetchedAtClientMs
        const serverOffsetSec = playbackOffsetSec(
            np.startedAtMs,
            state.serverNowMs,
        )
        const expectedSec = serverOffsetSec + clientElapsedMs / 1000

        if (this.#currentMediaId === np.mediaId && this.#ytPlayer) {
            // 同じ曲: ドリフト補正
            const localPositionSec =
                typeof this.#ytPlayer?.getCurrentTime === "function"
                    ? (this.#ytPlayer.getCurrentTime() ?? 0)
                    : 0
            const expectedOffsetSec =
                playbackOffsetSec(np.startedAtMs, state.serverNowMs) +
                (Date.now() - this.#fetchedAtClientMs) / 1000
            if (
                Math.abs(localPositionSec - expectedOffsetSec) >
                DRIFT_THRESHOLD_SEC
            ) {
                this.#ytPlayer.seekTo(expectedOffsetSec, true)
            }
            return
        }

        // 新しい曲: プレイヤーを生成/差し替え
        if (this.#ytPlayer) {
            this.#ytPlayer.loadVideoById(np.mediaId, expectedSec)
        } else {
            this.#ytPlayer = new window.YT.Player(this.#playerId, {
                videoId: np.mediaId,
                playerVars: { autoplay: 1, controls: 1 },
                events: {
                    onReady: (e: YTPlayerEvent): void => {
                        const currentExpected =
                            playbackOffsetSec(
                                np.startedAtMs,
                                state.serverNowMs,
                            ) +
                            (Date.now() - this.#fetchedAtClientMs) / 1000
                        e.target.seekTo(currentExpected, true)
                    },
                    onStateChange: (e: { data: number }): void => {
                        const ps = window.YT.PlayerState
                        // 再生/一時停止状態を再生ボタンへ反映
                        if (e.data === ps.PLAYING || e.data === ps.PAUSED) {
                            this.#isPlaying = e.data === ps.PLAYING
                            this.#renderUI()
                        }
                        // ENDED → 次のポーリングで advance されるのを待つだけ
                        if (e.data === ps.ENDED) {
                            this.#isPlaying = false
                            void this.#pollState()
                        }
                    },
                },
            })
        }
        this.#currentMediaId = np.mediaId
    }

    async #handleEnqueue(url: string): Promise<void> {
        const parsed = parseJukeboxUrl(url)
        if (!parsed) {
            this.#enqueueError =
                "YouTube または SoundCloud の URL を入力してください"
            this.#renderUI()
            return
        }
        try {
            await this.#client?.enqueue(url)
            this.#enqueueError = null
            // 即座に state を再取得してキューを更新
            void this.#pollState()
        } catch (e) {
            const status = (e as { status?: number }).status ?? 0
            // enqueueErrorMessage: 403/409/415/429 → 日本語メッセージ
            this.#enqueueError = enqueueErrorMessage(status)
            this.#renderUI()
        }
    }

    async #handleSkipVote(): Promise<void> {
        try {
            await this.#client?.skipVote()
            void this.#pollState()
        } catch {
            // サイレント無視
        }
    }

    async #handleCancelMine(): Promise<void> {
        try {
            await this.#client?.cancelMine()
            void this.#pollState()
        } catch {
            // サイレント無視
        }
    }

    /** 再生/一時停止ボタンのハンドラ。YT プレイヤーを直接トグルする。
     *  #syncPlayer は seekTo のみで再生を強制しないため、手動 pause は次の曲まで保持され、
     *  再生再開時に live 位置へ再同期される。 */
    #handleTogglePlay(): void {
        if (!this.#ytPlayer) return
        if (this.#isPlaying) {
            this.#ytPlayer.pauseVideo()
        } else {
            this.#ytPlayer.playVideo()
        }
    }

    #renderUI(): void {
        render(
            h(JukeboxUI, {
                state: this.#state,
                onEnqueue: (url: string) => this.#handleEnqueue(url),
                onSkipVote: () => this.#handleSkipVote(),
                onCancelMine: () => this.#handleCancelMine(),
                onTogglePlay: () => this.#handleTogglePlay(),
                // プレイヤー未生成/破棄後は再生中表示を残さない
                isPlaying: this.#ytPlayer != null && this.#isPlaying,
                enqueueError: this.#enqueueError,
                playerId: this.#playerId,
            }),
            this,
        )
    }
}
