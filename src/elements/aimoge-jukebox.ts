import { h, render } from "preact"
import { enqueueErrorMessage, JukeboxUI } from "../components/jukebox-ui"
import type { JukeboxClient } from "../io/jukebox-api"
import { createJukeboxClient } from "../io/jukebox-api"
import type { JukeboxHistoryItem, JukeboxState } from "../pure/jukebox"
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
// enqueue エラー文の自動消滅までの時間。読み切れる長さは残しつつ、
// クールダウン(可変・最短5分)明けまで残って「追加可能なのにエラー表示」になる矛盾を防ぐ。
const ENQUEUE_ERROR_TTL_MS = 12_000
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
    /** #enqueueError をセットした時刻(ms)。ENQUEUE_ERROR_TTL_MS 経過で #pollState が自動クリアする。 */
    #enqueueErrorAtMs: number = 0
    #ytPlayer: YTPlayer | null = null
    /** 現在プレイヤーに載っているトラックの行 id（mediaId ではなく id で識別する）。
     *  同じ mediaId が連続予約された場合でも id は変わるので、別トラックとして
     *  ロードし直せる（mediaId 一致だけで判定するとドリフト分岐に落ちて再生が始まらない）。 */
    #currentTrackId: number | null = null
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
    /** data-no-player 属性付きのときは YT プレイヤーを生成せず、再生/音量/動画 UI も出さない。
     *  PC 本窓のように「操作・表示だけ・再生は別窓に任せる」用途で使う。 */
    #noPlayer: boolean = false
    /** 再生履歴（直近24h）と表示状態。開いたときに /api/history を取得する。 */
    #history: JukeboxHistoryItem[] = []
    #showHistory: boolean = false
    /** 履歴取得のリクエスト連番。古い応答で最新を上書きしないための識別子。 */
    #historyReqId: number = 0
    #volume: number = readStoredVolume()
    /** ミュート中か。スピーカーアイコン押下でトグルし、player 再生成時も維持する。 */
    #muted: boolean = false
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

        // no-player モード: プレイヤーを持たず、操作・表示だけ行う（PC 本窓 → 再生は別窓に委譲）
        this.#noPlayer = this.hasAttribute("data-no-player")

        // YouTube IFrame API を読み込む（window.YT が無いとプレイヤーが生成されず真っ黒になる）
        // no-player モードでは不要なので読み込まない。
        if (!this.#noPlayer) loadYouTubeIframeApi()

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
        this.#currentTrackId = null
        // 再生中に破棄しても #isPlaying が残ると、再生成後の PLAYING で
        // playing && !#isPlaying が成立せず別タブ停止通知が飛ばない。合わせてリセットする。
        this.#isPlaying = false
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
            // enqueue エラーは即座には消さず（3秒ポーリングで消えると読めない）、
            // ENQUEUE_ERROR_TTL_MS 経過で自動クリアする。これで「クールダウン明けに
            // 追加可能なのにエラーが残る」矛盾を防ぎつつ、読み切れる時間は確保する。
            if (
                this.#enqueueError !== null &&
                fetchedAt - this.#enqueueErrorAtMs > ENQUEUE_ERROR_TTL_MS
            ) {
                this.#enqueueError = null
            }
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
        // no-player モードはプレイヤーを一切持たない（再生は別窓に委譲）
        if (this.#noPlayer) return
        const np = state.nowPlaying
        if (!np || np.source !== "youtube") {
            if (this.#ytPlayer) {
                this.#ytPlayer.destroy()
                this.#ytPlayer = null
                this.#currentTrackId = null
                // 破棄時は #isPlaying も倒す（再生成後の PLAYING 通知が飛ぶように）。
                this.#isPlaying = false
            }
            return
        }

        // window.YT が未ロードの場合はスキップ（次のポーリングで再試行）
        if (typeof window.YT?.Player !== "function") return

        const clientElapsedMs = Date.now() - this.#fetchedAtClientMs
        // 投影した現在時刻（serverNow + 取得後の経過）でクランプして期待位置を出す。
        // started_at_ms は曲送り直後だけ僅かに未来（ロードラグ吸収ぶん＝NEW_TRACK_START_LAG_MS、
        // ドリフト閾値未満）。その間は expectedSec が 0 に張り付くので新曲は先頭(0)付近から始まり、
        // ロード完了次第すぐ再生する（cue で待たせない）。閾値未満のリードなので巻き戻さない。
        const projectedNowMs = state.serverNowMs + clientElapsedMs
        const expectedSec = playbackOffsetSec(np.startedAtMs, projectedNowMs)

        if (this.#currentTrackId === np.id && this.#ytPlayer) {
            // 同じ曲: ドリフト補正（クランプ済み期待位置で比較）。
            const localPositionSec =
                typeof this.#ytPlayer?.getCurrentTime === "function"
                    ? (this.#ytPlayer.getCurrentTime() ?? 0)
                    : 0
            if (
                Math.abs(localPositionSec - expectedSec) > DRIFT_THRESHOLD_SEC
            ) {
                this.#ytPlayer.seekTo(expectedSec, true)
            }
            return
        }

        // 新しい曲: プレイヤーを生成/差し替え。
        // 再生希望ならロード完了次第すぐ再生（クランプ済みオフセット≒0から開始）、
        // 未再生なら cue で音を出さない。前倒し(NEW_TRACK_START_LAG_MS)はドリフト閾値未満なので
        // 即再生してもリードが閾値を超えず巻き戻らない＝待ち0・スキップ≒0。
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
                        // onReady 時点で投影現在時刻を取り直してクランプ（未来開始ぶんは0）
                        const readyProjectedMs =
                            state.serverNowMs +
                            (Date.now() - this.#fetchedAtClientMs)
                        const currentExpected = playbackOffsetSec(
                            np.startedAtMs,
                            readyProjectedMs,
                        )
                        e.target.seekTo(currentExpected, true)
                        e.target.setVolume(this.#volume)
                        // player 再生成（曲間など）でもミュート状態を引き継ぐ
                        if (this.#muted) e.target.mute()
                        // ユーザーの再生意図(#wantPlay)を尊重して、ロード完了次第すぐ再生する。
                        // 初期は #wantPlay=false なので一時停止のまま（自動再生しない）。
                        if (this.#wantPlay) e.target.playVideo()
                    },
                    onStateChange: (e: { data: number }): void => {
                        const ps = window.YT.PlayerState
                        // 再生/一時停止状態を再生ボタンへ反映
                        if (e.data === ps.PLAYING || e.data === ps.PAUSED) {
                            const playing = e.data === ps.PLAYING
                            // 「停止/一時停止 → 再生」へ移った時だけ他タブ/別窓へ通知する。
                            // ドリフト補正(同期)の seek 後にも PLAYING が再発火するが、その時は
                            // 既に再生中なので通知しない。さもないと同期のたびに別窓へ
                            // 「再生開始」通知が飛び、別窓側が一時停止して「急に止まる」。
                            if (playing && !this.#isPlaying) {
                                this.#playChannel?.postMessage({
                                    type: "playing",
                                    id: this.#instanceId,
                                })
                            }
                            // ネイティブ操作での一時停止もユーザーの停止意図として扱う
                            // （アプリの一時停止ボタンと同様に #wantPlay を倒す）。
                            if (!playing) this.#wantPlay = false
                            this.#isPlaying = playing
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
        this.#currentTrackId = np.id
    }

    async #handleEnqueue(url: string): Promise<void> {
        const parsed = parseJukeboxUrl(url)
        if (!parsed) {
            this.#enqueueError = "YouTube の URL を入力してください"
            this.#enqueueErrorAtMs = Date.now()
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
            this.#enqueueErrorAtMs = Date.now()
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

    async #handleCancelMine(trackId: number): Promise<void> {
        try {
            await this.#client?.cancelMine(trackId)
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
            const st = this.#state
            const np = st?.nowPlaying
            if (st && np) {
                // ライブ位置（クランプ済み＝開始前なら0）へ合わせてから再生。
                const projectedNowMs =
                    st.serverNowMs + (Date.now() - this.#fetchedAtClientMs)
                this.#ytPlayer.seekTo(
                    playbackOffsetSec(np.startedAtMs, projectedNowMs),
                    true,
                )
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

    /** スピーカーアイコン押下でミュート/解除をトグルする。 */
    #handleToggleMute(): void {
        this.#muted = !this.#muted
        if (this.#muted) this.#ytPlayer?.mute()
        else this.#ytPlayer?.unMute()
        this.#renderUI()
    }

    /** 再生履歴パネルの開閉。開いたときに /api/history を取得して表示する。 */
    async #handleToggleHistory(): Promise<void> {
        this.#showHistory = !this.#showHistory
        this.#renderUI()
        if (!this.#showHistory) return
        // 連打/遅延応答対策: 最新リクエストの応答だけを反映する（古い応答で上書きしない）。
        const reqId = ++this.#historyReqId
        try {
            const res = await this.#client?.getHistory()
            if (reqId !== this.#historyReqId) return
            this.#history = res?.history ?? []
            this.#renderUI()
        } catch {
            // 取得失敗はサイレント（空のまま）
        }
    }

    #renderUI(): void {
        render(
            h(JukeboxUI, {
                state: this.#state,
                onEnqueue: (url: string) => this.#handleEnqueue(url),
                onVote: (trackId: number) => this.#handleVote(trackId),
                onCancelMine: (trackId: number) =>
                    this.#handleCancelMine(trackId),
                onTogglePlay: () => this.#handleTogglePlay(),
                // プレイヤー未生成/破棄後は再生中表示を残さない
                isPlaying: this.#ytPlayer != null && this.#isPlaying,
                volume: this.#volume,
                onVolumeChange: (v: number) => this.#handleVolumeChange(v),
                muted: this.#muted,
                onToggleMute: () => this.#handleToggleMute(),
                // no-player モードでは動画・再生ボタン・音量を描画しない
                noPlayer: this.#noPlayer,
                history: this.#history,
                showHistory: this.#showHistory,
                onToggleHistory: () => void this.#handleToggleHistory(),
                enqueueError: this.#enqueueError,
                playerId: this.#playerId,
            }),
            this,
        )
    }
}
