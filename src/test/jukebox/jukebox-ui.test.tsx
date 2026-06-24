/** @jsxImportSource preact */
import { render } from "preact"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { JukeboxUI, type JukeboxUIProps } from "#js/components/jukebox-ui"
import type { JukeboxHistoryItem, JukeboxState } from "#js/pure/jukebox"

let container: HTMLDivElement

beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
})

afterEach(() => {
    render(null, container)
    container.remove()
})

function baseProps(overrides: Partial<JukeboxUIProps>): JukeboxUIProps {
    return {
        state: null,
        onEnqueue: async () => {},
        onVote: async () => {},
        onCancelMine: async () => {},
        onTogglePlay: () => {},
        isPlaying: false,
        volume: 50,
        onVolumeChange: () => {},
        muted: false,
        onToggleMute: () => {},
        noPlayer: true,
        history: [],
        showHistory: false,
        onToggleHistory: () => {},
        enqueueError: null,
        playerId: "test-player",
        ...overrides,
    }
}

describe("JukeboxUI — 予約キューの再生目安時刻", () => {
    it("各キュー項目に再生開始の目安時刻（HH:mm頃）を表示する", () => {
        const t0 = new Date(2026, 5, 24, 21, 0, 0).getTime()
        const state: JukeboxState = {
            // 現在の曲はちょうど開始したばかり(60秒)。終了=21:01。
            nowPlaying: {
                id: 1,
                source: "youtube",
                mediaId: "now00000000",
                title: "Now",
                durationSec: 60,
                mine: false,
                myVoted: false,
                startedAtMs: t0,
                isReplay: false,
            },
            serverNowMs: t0,
            queue: [
                {
                    id: 2,
                    source: "youtube",
                    mediaId: "q1aaaaaaaaa",
                    title: "Q1",
                    durationSec: 120,
                    mine: false,
                    myVoted: false,
                },
                {
                    id: 3,
                    source: "youtube",
                    mediaId: "q2aaaaaaaaa",
                    title: "Q2",
                    durationSec: 180,
                    mine: false,
                    myVoted: false,
                },
            ],
            listeners: 0,
            mySkipVoted: false,
            enqueueCooldownRemainingSec: 0,
        }
        render(<JukeboxUI {...baseProps({ state })} />, container)

        // queue[0] は現曲終了(21:01)、queue[1] は +120秒(21:03)
        const text = container.textContent ?? ""
        expect(text).toContain("21:01頃")
        expect(text).toContain("21:03頃")
    })
})

describe("JukeboxUI — 履歴の再生開始時刻", () => {
    it("各履歴項目に再生を開始した時刻（HH:mm）を表示する", () => {
        const history: JukeboxHistoryItem[] = [
            {
                id: 9,
                source: "youtube",
                mediaId: "hist0000000",
                title: "Played Song",
                durationSec: 200,
                startedAtMs: new Date(2026, 5, 24, 20, 57).getTime(),
                endedAtMs: new Date(2026, 5, 24, 21, 0).getTime(),
            },
        ]
        render(
            <JukeboxUI {...baseProps({ history, showHistory: true })} />,
            container,
        )
        const text = container.textContent ?? ""
        expect(text).toContain("Played Song")
        expect(text).toContain("20:57")
    })
})
