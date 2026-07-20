import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AnnounceBannerElement } from "#js/elements/announce-banner"
import {
  ANNOUNCE_CACHE_KEY,
  ANNOUNCE_DISMISSED_KEY,
} from "#js/io/announce-store"
import type { AnnounceCache, PublicAnnouncement } from "#js/pure/announce"
import { ANNOUNCE_STYLE_ID } from "#js/pure/announce-style"

// customElements.define は同名で二度呼べないため、ファイル全体で一度だけ定義する
if (customElements.get("announce-banner") == null) {
  AnnounceBannerElement.define()
}

const META = { article: "2026-07-15T12:00:00Z", banner: 42 }
const BANNERS: PublicAnnouncement[] = [
  {
    id: 1,
    title: "メンテナンスのお知らせ",
    body_md: "",
    body_html: "",
    level: "emergency",
    is_pinned: true,
    pinned_order: 0,
    is_banner: true,
    published_at: "2026-07-15T12:00:00Z",
    updated_at: "2026-07-18T18:07:07Z",
  },
  {
    id: 2,
    title: "今週のおすすめスレッド",
    body_md: "",
    body_html: "",
    level: "important",
    is_pinned: true,
    pinned_order: 1,
    is_banner: true,
    published_at: "2026-07-17T08:00:00Z",
    updated_at: "2026-07-18T18:07:07Z",
  },
]

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}

/** meta と banner を返す fetch スタブ。呼び出し URL を記録する */
function stubFetch(
  meta: typeof META = META,
  banners: PublicAnnouncement[] = BANNERS,
): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes("/api/v1/meta")) {
      return jsonResponse({ ok: true, data: meta })
    }
    if (url.includes("/api/v1/banner")) {
      return jsonResponse({ ok: true, data: banners })
    }
    return jsonResponse({
      ok: false,
      error: { code: "not_found", message: "no" },
    })
  })
  vi.stubGlobal("fetch", mock)
  return mock
}

function storedCache(): AnnounceCache {
  return JSON.parse(
    localStorage.getItem(ANNOUNCE_CACHE_KEY) ?? "null",
  ) as AnnounceCache
}

function writeCache(cache: Partial<AnnounceCache>): void {
  localStorage.setItem(
    ANNOUNCE_CACHE_KEY,
    JSON.stringify({
      lastMetaFetchedAt: null,
      seenArticle: null,
      article: null,
      bannerRev: null,
      banners: null,
      ...cache,
    }),
  )
}

/** connectedCallback 内の非同期フェッチ(#init)と Preact の再描画を完了させる */
async function flushAsync(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

async function mount(
  attrs: Record<string, string> = {},
): Promise<AnnounceBannerElement> {
  const el = document.createElement("announce-banner") as AnnounceBannerElement
  el.setAttribute("data-api-base", "https://announce.example")
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  document.body.appendChild(el)
  await flushAsync()
  return el
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  for (const el of Array.from(document.querySelectorAll("announce-banner"))) {
    el.remove()
  }
  document.getElementById(ANNOUNCE_STYLE_ID)?.remove()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("AnnounceBannerElement — 初回マウント", () => {
  it("meta → banner の順に取得して描画し、キャッシュを保存する", async () => {
    const fetchMock = stubFetch()
    const el = await mount()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/v1/meta")
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      "/api/v1/banner?limit=5",
    )
    expect(el.textContent).toContain("メンテナンスのお知らせ")
    const cache = storedCache()
    expect(cache.bannerRev).toBe(42)
    expect(cache.article).toBe(META.article)
    expect(cache.banners?.length).toBe(2)
  })

  it("style は複数インスタンスでも1つだけ注入される", async () => {
    stubFetch()
    await mount()
    await mount()
    expect(document.querySelectorAll(`#${ANNOUNCE_STYLE_ID}`).length).toBe(1)
  })

  it("バナー0件なら何も描画しない", async () => {
    stubFetch(META, [])
    const el = await mount()
    expect(el.querySelector(".aimg-announce-root")).toBeNull()
  })
})

describe("AnnounceBannerElement — 60秒スロットル", () => {
  it("60秒以内に meta 取得済みならフェッチしない(キャッシュから描画)", async () => {
    const fetchMock = stubFetch()
    writeCache({
      lastMetaFetchedAt: Date.now() - 30_000,
      article: META.article,
      bannerRev: 42,
      banners: BANNERS,
    })
    const el = await mount()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(el.textContent).toContain("メンテナンスのお知らせ")
  })

  it("60秒経過していれば meta を叩く。rev 一致なら banner は再取得しない", async () => {
    const fetchMock = stubFetch()
    writeCache({
      lastMetaFetchedAt: Date.now() - 61_000,
      article: META.article,
      bannerRev: 42,
      banners: BANNERS,
    })
    await mount()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/v1/meta")
  })

  it("rev 不一致なら banner を再取得してキャッシュを更新する", async () => {
    const fetchMock = stubFetch({ ...META, banner: 43 })
    writeCache({
      lastMetaFetchedAt: Date.now() - 61_000,
      article: META.article,
      bannerRev: 42,
      banners: BANNERS,
    })
    await mount()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(storedCache().bannerRev).toBe(43)
  })

  it("meta スキップ時でもバナーリストが無ければ取り直す(前回失敗のリカバリ)", async () => {
    const fetchMock = stubFetch()
    writeCache({
      lastMetaFetchedAt: Date.now() - 30_000,
      article: META.article,
      bannerRev: null,
      banners: null,
    })
    const el = await mount()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/v1/banner")
    expect(el.textContent).toContain("メンテナンスのお知らせ")
  })
})

describe("AnnounceBannerElement — ✕(非表示)", () => {
  it("✕クリックで sessionStorage に rev を記録して非表示になる", async () => {
    stubFetch()
    const el = await mount()
    const close = el.querySelector(".aimg-announce-close") as HTMLButtonElement
    close.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    )
    expect(sessionStorage.getItem(ANNOUNCE_DISMISSED_KEY)).toBe("42")
    expect(el.querySelector(".aimg-announce-root")).toBeNull()
  })

  it("dismissed rev が現在の rev と一致していれば最初から描画しない", async () => {
    stubFetch()
    writeCache({
      lastMetaFetchedAt: Date.now() - 30_000,
      article: META.article,
      bannerRev: 42,
      banners: BANNERS,
    })
    sessionStorage.setItem(ANNOUNCE_DISMISSED_KEY, "42")
    const el = await mount()
    expect(el.querySelector(".aimg-announce-root")).toBeNull()
  })

  it("rev が変わっていれば dismissed でも再表示する", async () => {
    stubFetch({ ...META, banner: 43 })
    writeCache({
      lastMetaFetchedAt: Date.now() - 61_000,
      article: META.article,
      bannerRev: 42,
      banners: BANNERS,
    })
    sessionStorage.setItem(ANNOUNCE_DISMISSED_KEY, "42")
    const el = await mount()
    expect(el.querySelector(".aimg-announce-root")).not.toBeNull()
  })
})

describe("AnnounceBannerElement — 未読バッジと既読記録", () => {
  it("seenArticle と article が異なればバッジが出る", async () => {
    stubFetch()
    const el = await mount()
    expect(el.querySelector(".aimg-announce-badge")).not.toBeNull()
  })

  it("リンククリックで seenArticle が記録され、以後バッジ条件が消える", async () => {
    stubFetch()
    const el = await mount()
    const link = el.querySelector(".aimg-announce-link") as HTMLAnchorElement
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true })
    // jsdom の実ナビゲーションを避けるためリスナー最後で抑止する
    link.addEventListener("click", (e) => e.preventDefault())
    link.dispatchEvent(ev)
    expect(storedCache().seenArticle).toBe(META.article)
  })

  it("seenArticle が最新なら バッジは出ない", async () => {
    stubFetch()
    writeCache({
      lastMetaFetchedAt: Date.now() - 30_000,
      seenArticle: META.article,
      article: META.article,
      bannerRev: 42,
      banners: BANNERS,
    })
    const el = await mount()
    expect(el.querySelector(".aimg-announce-badge")).toBeNull()
  })
})

describe("AnnounceBannerElement — 異常系", () => {
  it("キャッシュが壊れた JSON でも例外なく初回同様に動く", async () => {
    localStorage.setItem(ANNOUNCE_CACHE_KEY, "{broken json")
    stubFetch()
    const el = await mount()
    expect(el.textContent).toContain("メンテナンスのお知らせ")
  })

  it("meta 取得失敗時はキャッシュから静かに描画する", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network down")
      }),
    )
    writeCache({
      lastMetaFetchedAt: Date.now() - 120_000,
      article: META.article,
      bannerRev: 42,
      banners: BANNERS,
    })
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const el = await mount()
    expect(el.textContent).toContain("メンテナンスのお知らせ")
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it("disconnect 後に解決したフェッチは描画しない(abort)", async () => {
    // コールバック内代入は TS のフロー解析が追えないため、配列に積んで後で解決する
    const resolvers: Array<(r: Response) => void> = []
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((resolve, reject) => {
            resolvers.push(resolve)
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            )
          }),
      ),
    )
    const el = document.createElement(
      "announce-banner",
    ) as AnnounceBannerElement
    el.setAttribute("data-api-base", "https://announce.example")
    document.body.appendChild(el)
    el.remove()
    for (const resolve of resolvers)
      resolve(jsonResponse({ ok: true, data: META }))
    await flushAsync()
    expect(el.querySelector(".aimg-announce-root")).toBeNull()
  })
})
