import { h, render } from "preact";
import { createJukeboxClient } from "#js/io/jukebox-api";
import type { JukeboxClient } from "#js/io/jukebox-api";
import type { JukeboxState } from "#js/pure/jukebox";
import { parseJukeboxUrl, playbackOffsetSec } from "#js/pure/jukebox";
import { JukeboxUI, enqueueErrorMessage } from "#js/components/jukebox-ui";
import type { CustomElementClass } from "./types";

// ─── YouTube IFrame Player API ambient types ──────────────────────────────────
interface YTPlayer {
	seekTo(sec: number, allowSeekAhead: boolean): void;
	loadVideoById(videoId: string, startSeconds?: number): void;
	destroy(): void;
}

interface YTPlayerEvent {
	target: YTPlayer;
}

declare global {
	interface Window {
		YT: {
			Player: new (
				elementId: string,
				opts: {
					videoId: string;
					playerVars?: Record<string, unknown>;
					events?: {
						onReady?: (e: YTPlayerEvent) => void;
						onStateChange?: (e: { data: number }) => void;
					};
				},
			) => YTPlayer;
			PlayerState: { ENDED: number };
		};
		onYouTubeIframeAPIReady?: () => void;
	}
}
// ─────────────────────────────────────────────────────────────────────────────

const STATE_INTERVAL_MS = 3_000;
const PRESENCE_INTERVAL_MS = 10_000;
const DRIFT_THRESHOLD_SEC = 2;
const DEFAULT_BASE_URL = "https://music.nijiurachan.net";

/**
 * あいもげジュークボックス custom element。
 * `data-api-base` 属性でバックエンドの base URL を指定できる（省略時は DEFAULT_BASE_URL）。
 *
 * 登録: `AimogeJukeboxElement.define()`
 */
export class AimogeJukeboxElement extends HTMLElement implements CustomElementClass {
	#client: JukeboxClient | null = null;
	#stateTimer: ReturnType<typeof setInterval> | null = null;
	#presenceTimer: ReturnType<typeof setInterval> | null = null;
	#abortController: AbortController | null = null;
	#state: JukeboxState | null = null;
	#enqueueError: string | null = null;
	#ytPlayer: YTPlayer | null = null;
	#currentMediaId: string | null = null;
	#fetchedAtClientMs: number = 0;

	static define(): void {
		customElements.define("aimoge-jukebox", AimogeJukeboxElement);
	}

	connectedCallback(): void {
		const baseUrl = this.getAttribute("data-api-base")?.trim() || DEFAULT_BASE_URL;
		this.#client = createJukeboxClient({ baseUrl });

		void this.#pollState();
		this.#stateTimer = setInterval(() => void this.#pollState(), STATE_INTERVAL_MS);
		this.#presenceTimer = setInterval(
			() => void this.#sendPresence(),
			PRESENCE_INTERVAL_MS,
		);
	}

	disconnectedCallback(): void {
		if (this.#stateTimer !== null) {
			clearInterval(this.#stateTimer);
			this.#stateTimer = null;
		}
		if (this.#presenceTimer !== null) {
			clearInterval(this.#presenceTimer);
			this.#presenceTimer = null;
		}
		this.#abortController?.abort();
		this.#abortController = null;
		this.#ytPlayer?.destroy();
		this.#ytPlayer = null;
		this.#currentMediaId = null;
		render(null, this);
	}

	async #pollState(): Promise<void> {
		this.#abortController?.abort();
		const controller = new AbortController();
		this.#abortController = controller;

		try {
			const fetchedAt = Date.now();
			const state = await this.#client!.getState();
			if (controller.signal.aborted) return;
			this.#fetchedAtClientMs = fetchedAt;
			this.#state = state;
			this.#enqueueError = null;
			this.#syncPlayer(state);
			this.#renderUI();
		} catch {
			if (!controller.signal.aborted) {
				// ネットワークエラー: 既存 UI は維持したまま次のポーリングを待つ
			}
		}
	}

	async #sendPresence(): Promise<void> {
		if (!this.#client) return;
		try {
			await this.#client.postPresence();
		} catch {
			// presence の失敗はサイレントに無視する
		}
	}

	#syncPlayer(state: JukeboxState): void {
		const np = state.nowPlaying;
		if (!np || np.source !== "youtube") {
			if (this.#ytPlayer) {
				this.#ytPlayer.destroy();
				this.#ytPlayer = null;
				this.#currentMediaId = null;
			}
			return;
		}

		const clientElapsedMs = Date.now() - this.#fetchedAtClientMs;
		const serverOffsetSec = playbackOffsetSec(np.startedAtMs, state.serverNowMs);
		const expectedSec = serverOffsetSec + clientElapsedMs / 1000;

		if (this.#currentMediaId === np.mediaId && this.#ytPlayer) {
			// 同じ曲: ドリフト補正。
			// YT IFrame API には getCurrentTime がないため localPos は 0 とみなす
			const localPositionSec = 0;
			const expectedOffsetSec =
				playbackOffsetSec(np.startedAtMs, state.serverNowMs) +
				(Date.now() - this.#fetchedAtClientMs) / 1000;
			if (Math.abs(localPositionSec - expectedOffsetSec) > DRIFT_THRESHOLD_SEC) {
				this.#ytPlayer.seekTo(expectedOffsetSec, true);
			}
			return;
		}

		// 新しい曲: プレイヤーを生成/差し替え
		if (this.#ytPlayer) {
			this.#ytPlayer.loadVideoById(np.mediaId, expectedSec);
		} else {
			this.#ytPlayer = new window.YT.Player("jukebox-yt-player", {
				videoId: np.mediaId,
				playerVars: { autoplay: 1, controls: 1 },
				events: {
					onReady: (e: YTPlayerEvent) => {
						const currentExpected =
							playbackOffsetSec(np.startedAtMs, state.serverNowMs) +
							(Date.now() - this.#fetchedAtClientMs) / 1000;
						e.target.seekTo(currentExpected, true);
					},
					onStateChange: (e: { data: number }) => {
						// ENDED → 次のポーリングで advance されるのを待つだけ
						if (e.data === window.YT.PlayerState.ENDED) {
							void this.#pollState();
						}
					},
				},
			});
		}
		this.#currentMediaId = np.mediaId;
	}

	async #handleEnqueue(url: string): Promise<void> {
		const parsed = parseJukeboxUrl(url);
		if (!parsed) {
			this.#enqueueError = "YouTube の URL を入力してください";
			this.#renderUI();
			return;
		}
		try {
			await this.#client!.enqueue(url);
			this.#enqueueError = null;
			// 即座に state を再取得してキューを更新
			void this.#pollState();
		} catch (e) {
			const status = (e as { status?: number }).status ?? 0;
			// enqueueErrorMessage: 403/409/415/429 → 日本語メッセージ
			this.#enqueueError = enqueueErrorMessage(status);
			this.#renderUI();
		}
	}

	async #handleSkipVote(): Promise<void> {
		try {
			await this.#client!.skipVote();
			void this.#pollState();
		} catch {
			// サイレント無視
		}
	}

	async #handleCancelMine(): Promise<void> {
		try {
			await this.#client!.cancelMine();
			void this.#pollState();
		} catch {
			// サイレント無視
		}
	}

	#renderUI(): void {
		render(
			h(JukeboxUI, {
				state: this.#state,
				onEnqueue: (url: string) => this.#handleEnqueue(url),
				onSkipVote: () => this.#handleSkipVote(),
				onCancelMine: () => this.#handleCancelMine(),
				enqueueError: this.#enqueueError,
			}),
			this,
		);
	}
}
