import { describe, expect, it } from "vitest"
import {
  computeQueueEtaMs,
  formatClockTime,
  parseJukeboxUrl,
  playbackOffsetSec,
} from "#js/pure/jukebox"

describe("parseJukeboxUrl — YouTube watch?v=", () => {
  it("parses standard watch URL", () => {
    expect(
      parseJukeboxUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    ).toEqual({
      source: "youtube",
      mediaId: "dQw4w9WgXcQ",
    })
  })

  it("ignores extra query params", () => {
    expect(
      parseJukeboxUrl("https://youtube.com/watch?v=abcdefghijk&t=30"),
    ).toEqual({
      source: "youtube",
      mediaId: "abcdefghijk",
    })
  })

  it("returns null when v param is missing", () => {
    expect(
      parseJukeboxUrl("https://www.youtube.com/watch?list=PLxxx"),
    ).toBeNull()
  })

  it("returns null when mediaId is not exactly 11 chars", () => {
    expect(parseJukeboxUrl("https://www.youtube.com/watch?v=short")).toBeNull()
    expect(
      parseJukeboxUrl("https://www.youtube.com/watch?v=toolongidhere123"),
    ).toBeNull()
  })
})

describe("parseJukeboxUrl — YouTube youtu.be short link", () => {
  it("parses youtu.be URL", () => {
    expect(parseJukeboxUrl("https://youtu.be/dQw4w9WgXcQ")).toEqual({
      source: "youtube",
      mediaId: "dQw4w9WgXcQ",
    })
  })

  it("parses youtu.be with query params", () => {
    expect(parseJukeboxUrl("https://youtu.be/abcdefghijk?t=5")).toEqual({
      source: "youtube",
      mediaId: "abcdefghijk",
    })
  })

  it("returns null when youtu.be path is not exactly 11 chars", () => {
    expect(parseJukeboxUrl("https://youtu.be/short")).toBeNull()
  })
})

describe("parseJukeboxUrl — YouTube shorts/", () => {
  it("parses shorts URL", () => {
    expect(
      parseJukeboxUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ"),
    ).toEqual({
      source: "youtube",
      mediaId: "dQw4w9WgXcQ",
    })
  })

  it("returns null when shorts ID is wrong length", () => {
    expect(parseJukeboxUrl("https://www.youtube.com/shorts/abc")).toBeNull()
  })
})

describe("parseJukeboxUrl — SoundCloud は非対応（廃止）", () => {
  it("returns null for soundcloud.com/<user>/<track>", () => {
    expect(
      parseJukeboxUrl("https://soundcloud.com/artist-name/track-title"),
    ).toBeNull()
  })

  it("returns null with www prefix", () => {
    expect(parseJukeboxUrl("https://www.soundcloud.com/dj/my-song")).toBeNull()
  })

  it("returns null for soundcloud root", () => {
    expect(parseJukeboxUrl("https://soundcloud.com/")).toBeNull()
  })
})

describe("parseJukeboxUrl — invalid / unsupported URLs", () => {
  it("returns null for empty string", () => {
    expect(parseJukeboxUrl("")).toBeNull()
  })

  it("returns null for plain text", () => {
    expect(parseJukeboxUrl("not a url")).toBeNull()
  })

  it("returns null for an unrelated URL", () => {
    expect(
      parseJukeboxUrl("https://example.com/watch?v=dQw4w9WgXcQ"),
    ).toBeNull()
  })

  it("returns null for vimeo URL", () => {
    expect(parseJukeboxUrl("https://vimeo.com/123456789")).toBeNull()
  })
})

describe("playbackOffsetSec", () => {
  it("returns 0 when serverNow is before startedAt (clamp)", () => {
    expect(playbackOffsetSec(1_000_000, 999_000)).toBe(0)
  })

  it("returns correct offset in seconds", () => {
    expect(playbackOffsetSec(1_000_000, 1_005_000)).toBe(5)
  })

  it("returns fractional seconds", () => {
    expect(playbackOffsetSec(1_000_000, 1_002_500)).toBe(2.5)
  })

  it("clamps to 0 when times are equal", () => {
    expect(playbackOffsetSec(1_000_000, 1_000_000)).toBe(0)
  })
})

describe("computeQueueEtaMs", () => {
  const np = (
    startedAtMs: number,
    durationSec: number,
  ): { startedAtMs: number; durationSec: number } => ({
    startedAtMs,
    durationSec,
  })
  const item = (durationSec: number): { durationSec: number } => ({
    durationSec,
  })

  it("returns [] for an empty queue", () => {
    expect(computeQueueEtaMs(np(0, 100), [], 0)).toEqual([])
  })

  it("first item starts when the current track ends", () => {
    // 現在の曲は startedAt=1,000,000ms, 100秒 → 終了は 1,100,000ms。
    // serverNow はまだ曲の途中(1,030,000ms)。
    const eta = computeQueueEtaMs(
      np(1_000_000, 100),
      [item(60), item(30)],
      1_030_000,
    )
    // queue[0] は現曲終了時刻に開始、queue[1] は +60秒
    expect(eta).toEqual([1_100_000, 1_160_000])
  })

  it("clamps the base to serverNow when the current track has already overrun", () => {
    // 現曲は 1,000,000ms + 100秒 = 1,100,000ms に終わるはずだが、
    // serverNow は既に 1,200,000ms（advance 待ち）→ 次曲は今すぐ開始扱い。
    const eta = computeQueueEtaMs(
      np(1_000_000, 100),
      [item(60), item(40)],
      1_200_000,
    )
    expect(eta).toEqual([1_200_000, 1_260_000])
  })

  it("starts the first item at serverNow when nothing is playing", () => {
    const eta = computeQueueEtaMs(null, [item(120), item(60)], 5_000_000)
    expect(eta).toEqual([5_000_000, 5_120_000])
  })

  it("accumulates durations across many items", () => {
    const eta = computeQueueEtaMs(np(0, 10), [item(10), item(20), item(30)], 0)
    // base = 0 + 10s = 10,000ms; then +10s, +20s
    expect(eta).toEqual([10_000, 20_000, 40_000])
  })
})

describe("formatClockTime", () => {
  it("formats an epoch ms as zero-padded local HH:mm", () => {
    // ローカル時刻で構築 → ローカル時刻で整形するのでタイムゾーン非依存
    const t = new Date(2026, 5, 24, 21, 5).getTime()
    expect(formatClockTime(t)).toBe("21:05")
  })

  it("zero-pads single-digit hours and minutes", () => {
    const t = new Date(2026, 0, 1, 9, 3).getTime()
    expect(formatClockTime(t)).toBe("09:03")
  })

  it("formats midnight as 00:00", () => {
    const t = new Date(2026, 0, 1, 0, 0).getTime()
    expect(formatClockTime(t)).toBe("00:00")
  })

  it("returns --:-- for non-finite input (NaN/undefined/Infinity)", () => {
    // 旧 /api/history（startedAtMs 欠損）等で undefined/NaN が渡ると
    // new Date(NaN) → "NaN:NaN" になるのを防ぐ。
    expect(formatClockTime(Number.NaN)).toBe("--:--")
    expect(formatClockTime(undefined as unknown as number)).toBe("--:--")
    expect(formatClockTime(Number.POSITIVE_INFINITY)).toBe("--:--")
  })
})
