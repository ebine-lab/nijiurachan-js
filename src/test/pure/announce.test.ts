import { describe, expect, it } from "vitest"
import {
  type AnnounceCache,
  emptyAnnounceCache,
  hasNewArticle,
  isDismissed,
  levelClass,
  levelPrefix,
  nextBannerIndex,
  type PublicAnnouncement,
  parseAnnounceCache,
  rotateDurationMs,
  serializeAnnounceCache,
  shouldFetchMeta,
  shouldRefetchBanner,
} from "#js/pure/announce"

const T0 = 1_752_580_000_000

function sampleBanner(
  overrides: Partial<PublicAnnouncement> = {},
): PublicAnnouncement {
  return {
    id: 1,
    title: "メンテナンスのお知らせ",
    body_md: "**md**",
    body_html: "<p><strong>md</strong></p>",
    level: "emergency",
    is_pinned: true,
    pinned_order: 0,
    is_banner: true,
    published_at: "2026-07-15T12:00:00Z",
    updated_at: "2026-07-18T18:07:07Z",
    ...overrides,
  }
}

describe("shouldFetchMeta", () => {
  it("一度も叩いていなければ true", () => {
    expect(shouldFetchMeta(null, T0)).toBe(true)
  })
  it("59.999秒経過では false(60秒スロットル)", () => {
    expect(shouldFetchMeta(T0, T0 + 59_999)).toBe(false)
  })
  it("ちょうど60秒経過で true", () => {
    expect(shouldFetchMeta(T0, T0 + 60_000)).toBe(true)
  })
})

describe("shouldRefetchBanner", () => {
  it("キャッシュ済みリストが無ければ true", () => {
    expect(shouldRefetchBanner(42, 42, false)).toBe(true)
  })
  it("rev 不一致なら true(増加方向)", () => {
    expect(shouldRefetchBanner(41, 42, true)).toBe(true)
  })
  it("rev 不一致なら true(大小に意味は無い: 逆方向でも)", () => {
    expect(shouldRefetchBanner(43, 42, true)).toBe(true)
  })
  it("rev 一致かつリスト有りなら false", () => {
    expect(shouldRefetchBanner(42, 42, true)).toBe(false)
  })
  it("meta が取れていない(metaRev null)ならキャッシュ維持で false", () => {
    expect(shouldRefetchBanner(null, null, false)).toBe(false)
  })
})

describe("hasNewArticle", () => {
  it("未読(seen null)で article があれば true", () => {
    expect(hasNewArticle(null, "2026-07-15T12:00:00Z")).toBe(true)
  })
  it("既読と一致すれば false", () => {
    expect(hasNewArticle("2026-07-15T12:00:00Z", "2026-07-15T12:00:00Z")).toBe(
      false,
    )
  })
  it("article が null(公開記事ゼロ)なら false", () => {
    expect(hasNewArticle(null, null)).toBe(false)
  })
  it("既読より進んでいれば true", () => {
    expect(hasNewArticle("2026-07-15T12:00:00Z", "2026-07-16T00:00:00Z")).toBe(
      true,
    )
  })
})

describe("isDismissed", () => {
  it("閉じた rev と現在 rev が一致していれば true", () => {
    expect(isDismissed(42, 42)).toBe(true)
  })
  it("rev が変わっていれば false(再表示)", () => {
    expect(isDismissed(41, 42)).toBe(false)
  })
  it("閉じていなければ false", () => {
    expect(isDismissed(null, 42)).toBe(false)
  })
})

describe("nextBannerIndex", () => {
  it("末尾で先頭に戻る", () => {
    expect(nextBannerIndex(0, 3)).toBe(1)
    expect(nextBannerIndex(2, 3)).toBe(0)
  })
  it("length 0 でも 0 を返す(ゼロ除算しない)", () => {
    expect(nextBannerIndex(0, 0)).toBe(0)
  })
})

describe("rotateDurationMs", () => {
  it("normal は基準値のまま", () => {
    expect(rotateDurationMs(5000, "normal")).toBe(5000)
  })
  it("important は +1.5秒", () => {
    expect(rotateDurationMs(5000, "important")).toBe(6500)
  })
  it("emergency は +2.5秒", () => {
    expect(rotateDurationMs(5000, "emergency")).toBe(7500)
  })
})

describe("levelPrefix / levelClass", () => {
  it("emergency は 🚨", () => {
    expect(levelPrefix("emergency")).toBe("🚨")
    expect(levelClass("emergency")).toBe("aimg-announce-lv-emergency")
  })
  it("important は ⭐️", () => {
    expect(levelPrefix("important")).toBe("⭐️")
    expect(levelClass("important")).toBe("aimg-announce-lv-important")
  })
  it("normal は前置なし", () => {
    expect(levelPrefix("normal")).toBe("")
    expect(levelClass("normal")).toBe("aimg-announce-lv-normal")
  })
})

describe("parseAnnounceCache", () => {
  it("null は既定値", () => {
    expect(parseAnnounceCache(null)).toEqual(emptyAnnounceCache())
  })
  it("壊れた JSON は既定値", () => {
    expect(parseAnnounceCache("not json{")).toEqual(emptyAnnounceCache())
  })
  it("配列など object 以外は既定値", () => {
    expect(parseAnnounceCache("[]")).toEqual(emptyAnnounceCache())
  })
  it("型不一致のフィールドは捨てて既定値に矯正する", () => {
    const raw = JSON.stringify({
      lastMetaFetchedAt: "not-number",
      seenArticle: 123,
      article: "2026-07-15T12:00:00Z",
      bannerRev: Number.NaN,
      banners: [{ broken: true }],
    })
    const cache = parseAnnounceCache(raw)
    expect(cache.lastMetaFetchedAt).toBeNull()
    expect(cache.seenArticle).toBeNull()
    expect(cache.article).toBe("2026-07-15T12:00:00Z")
    expect(cache.bannerRev).toBeNull()
    expect(cache.banners).toBeNull()
  })
  it("serialize との round-trip が成立する", () => {
    const cache: AnnounceCache = {
      lastMetaFetchedAt: T0,
      seenArticle: "2026-07-15T12:00:00Z",
      article: "2026-07-16T00:00:00Z",
      bannerRev: 42,
      banners: [sampleBanner(), sampleBanner({ id: 2, level: "important" })],
    }
    expect(parseAnnounceCache(serializeAnnounceCache(cache))).toEqual(cache)
  })
})
