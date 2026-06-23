import { h, render } from "preact"
import { enqueueErrorMessage, JukeboxUI } from "../components/jukebox-ui"
import type { JukeboxClient } from "../io/jukebox-api"
import { createJukeboxClient } from "../io/jukebox-api"
import type { JukeboxState } from "../pure/jukebox"
import { parseJukeboxUrl, playbackOffsetSec } from "../pure/jukebox"

// 音量(0-100)は localStorage に永続化する。初期値は真ん中(50)。
const VOLUME_STORAGE_KEY = "aimoge_jukebox_volume"
const DEFAULT_VOLUME = 50
function readStoredVolume(): number {
    try {
        if (typeof localStorage === "undefined") return DEFAULT_VOLUME
        const raw = localStorage.getItem(VOLUME_STORAGE_KEY)
        const n = raw == null ? Number.NaN : Number(raw)
        return Number.isFinite(n) && n >= 0 && n <= 100 ? n : DEFAULT_VOLUME
    } catch {
        // プライベートブラウジング / SecurityError 等で getItem が投げる環境 → 既定値
        return DEFAULT_VOLUME
    }
}

// タブ/窓をまたいで一意なインスタンス ID（BroadcastChannel の送信元判定用）。
// #playerId はページ内 counter（各タブで 1 から振り直す）なので別タブと衝突する。別途用意する。
function makeInstanceId(): string {
    if (
        typeof crypto !== "undefined" &&
        typeof crypto.randomUUID === "function"
    ) {
        return crypto.randomUUID()
    }
    return `jbx-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

// ─── YouTube IFrame Player API ambient types ──────────────────────────────────
interface YTPlayer {
    seekTo(sec: number, allowSeekAhead: boolean): void
    loadVideoById(videoId: string, startSeconds?: number): void
    cueVideoById(videoId: string, startSeconds?: number): void
    getCurrentTime(): number
    playVideo(): void
    pauseVideo(): void
    setVolume(volume: number): void
    getVolume(): number
    mute(): void
    unMute(): void
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
 * YouTube IFrame Player API をロードする（未ロードのときだけ <script> を一度注入）。
 * ロード完了で window.YT.Player が使えるようになり、次のポーリングで #syncPlayer が
 * プレイヤーを生成する。これが無いと window.YT が永遠に undefined で再生されない（画面が真っ黒）。
 */
function loadYouTubeIframeApi(): void {
    if (typeof window === "undefined" || typeof document === "undefined") return
    if (window.YT?.Player) return
    const SRC = "https://www.youtube.com/iframe_api"
    if (document.querySelector(`script[src="${SRC}"]`)) return
    const tag = document.createElement("script")
    tag.src = SRC
    tag.async = true
    // 読み込み失敗時は失敗した <script> を DOM から除去する。残すと
    // querySelector の二重注入ガードが恒久発動し、一度でも失敗すると
    // リロードするまで再注入されず（プレイヤーが永遠に真っ黒に）なるため。
    tag.onerror = (): void => {
        tag.remove()
    }
    document.head.appendChild(tag)
}

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
    /** ユーザーが再生を望んでいるか。デフォルトは false＝一時停止（自動再生しない）。
     *  曲が server 側で進んでも、これが false の間は cue のみで音を出さない。 */
    #wantPlay: boolean = false
    /** 複数タブ/別窓での二重再生を防ぐチャンネル（誰かが再生したら他は止める） */
    #playChannel: BroadcastChannel | null = null
    /** BroadcastChannel 送信元判定用のタブ横断で一意な ID（#playerId は別タブと衝突するため別途） */
    readonly #instanceId: string = makeInstanceId()
    #volume: number = readStoredVolume()
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

        // YouTube IFrame API を読み込む（window.YT が無いとプレイヤーが生成されず真っ黒になる）
        loadYouTubeIframeApi()

        // 二重再生防止: 別タブ/別窓のジュークボックスが再生を始めたらこちらは止める
        if (typeof BroadcastChannel !== "undefined") {
            this.#playChannel = new BroadcastChannel("aimoge-jukebox")
            this.#playChannel.onmessage = (ev: MessageEvent): void => {
                const msg = ev.data as { type?: string; id?: string }
                if (
                    msg?.type === "playing" &&
                    msg.id !== this.#instanceId &&
                    this.#isPlaying
                ) {
                    this.#wantPlay = false
                    this.#ytPlayer?.pauseVideo()
                }
            }
        }

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
        this.#playChannel?.close()
        this.#playChannel = null
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

        // 新しい曲: プレイヤーを生成/差し替え。
        // ユーザーが再生中(#wantPlay)なら load で続けて再生、未再生なら cue で音を出さない。
        if (this.#ytPlayer) {
            if (this.#wantPlay) {
                this.#ytPlayer.loadVideoById(np.mediaId, expectedSec)
            } else {
                this.#ytPlayer.cueVideoById(np.mediaId, expectedSec)
            }
        } else {
            this.#ytPlayer = new window.YT.Player(this.#playerId, {
                videoId: np.mediaId,
                // autoplay:0 = デフォルト一時停止。再生は #handleTogglePlay（ユーザー操作）から。
                playerVars: { autoplay: 0, controls: 1 },
                events: {
                    onReady: (e: YTPlayerEvent): void => {
                        const currentExpected =
                            playbackOffsetSec(
                                np.startedAtMs,
                                state.serverNowMs,
                            ) +
                            (Date.now() - this.#fetchedAtClientMs) / 1000
                        e.target.seekTo(currentExpected, true)
                        e.target.setVolume(this.#volume)
                        // 破棄→再生成フロー（曲間でキューが空→新曲、source 遷移など）でも
                        // ユーザーの再生意図(#wantPlay)を尊重して再開する。
                        // 初期は #wantPlay=false なので一時停止のまま（自動再生しない）。
                        if (this.#wantPlay) e.target.playVideo()
                    },
                    onStateChange: (e: { data: number }): void => {
                        const ps = window.YT.PlayerState
                        // 再生/一時停止状態を再生ボタンへ反映
                        if (e.data === ps.PLAYING || e.data === ps.PAUSED) {
                            this.#isPlaying = e.data === ps.PLAYING
                            // 自分が再生を始めたら、他タブ/別窓に通知して止めさせる
                            if (this.#isPlaying) {
                                this.#playChannel?.postMessage({
                                    type: "playing",
                                    id: this.#instanceId,
                                })
                            }
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
            const err = e as { status?: number; code?: string | null }
            // enqueueErrorMessage: code(duration_too_long 等) 優先 → 403/409/415/429
            this.#enqueueError = enqueueErrorMessage(err.status ?? 0, err.code)
            this.#renderUI()
        }
    }

    async #handleVote(trackId: number): Promise<void> {
        try {
            await this.#client?.vote(trackId)
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
            this.#wantPlay = false
            this.#ytPlayer.pauseVideo()
        } else {
            this.#wantPlay = true
            // 再生開始時はライブ位置へ合わせてから再生（押した時点の現在地に追いつく）
            const st = this.#state
            const np = st?.nowPlaying
            if (st && np) {
                const liveSec =
                    playbackOffsetSec(np.startedAtMs, st.serverNowMs) +
                    (Date.now() - this.#fetchedAtClientMs) / 1000
                this.#ytPlayer.seekTo(liveSec, true)
            }
            this.#ytPlayer.playVideo()
        }
    }

    /** 音量(0-100)変更。プレイヤーへ即反映し localStorage に永続化する。
     *  スライダー側がローカル state を持つため #renderUI は呼ばない（ドラッグ毎の全再描画回避）。 */
    #handleVolumeChange(volume: number): void {
        this.#volume = volume
        this.#ytPlayer?.setVolume(volume)
        try {
            if (typeof localStorage !== "undefined") {
                localStorage.setItem(VOLUME_STORAGE_KEY, String(volume))
            }
        } catch {
            // 保存不可環境（プライベートブラウジング / SecurityError 等）は無視
        }
    }

    #renderUI(): void {
        render(
            h(JukeboxUI, {
                state: this.#state,
                onEnqueue: (url: string) => this.#handleEnqueue(url),
                onVote: (trackId: number) => this.#handleVote(trackId),
                onCancelMine: () => this.#handleCancelMine(),
                onTogglePlay: () => this.#handleTogglePlay(),
                // プレイヤー未生成/破棄後は再生中表示を残さない
                isPlaying: this.#ytPlayer != null && this.#isPlaying,
                volume: this.#volume,
                onVolumeChange: (v: number) => this.#handleVolumeChange(v),
                enqueueError: this.#enqueueError,
                playerId: this.#playerId,
            }),
            this,
        )
    }
}
