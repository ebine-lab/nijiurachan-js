import { afterEach, describe, expect, it, vi } from "vitest"
import { AnnounceApiError, createAnnounceClient } from "#js/io/announce-api"

function jsonResponse(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("createAnnounceClient", () => {
  it("getMeta は {base}/api/v1/meta を credentials:omit の GET で叩き data を返す", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        ok: true,
        data: { article: "2026-07-15T12:00:00Z", banner: 0 },
      }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const client = createAnnounceClient({ baseUrl: "https://announce.example" })
    const meta = await client.getMeta()
    expect(meta).toEqual({ article: "2026-07-15T12:00:00Z", banner: 0 })
    expect(fetchMock).toHaveBeenCalledWith(
      "https://announce.example/api/v1/meta",
      expect.objectContaining({ method: "GET", credentials: "omit" }),
    )
  })

  it("baseUrl の末尾スラッシュは除去される", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true, data: [] }))
    vi.stubGlobal("fetch", fetchMock)
    const client = createAnnounceClient({
      baseUrl: "https://announce.example/",
    })
    await client.getBanner(5)
    expect(fetchMock).toHaveBeenCalledWith(
      "https://announce.example/api/v1/banner?limit=5",
      expect.anything(),
    )
  })

  it("getBanner は limit をクエリに付け、配列を順序そのまま返す", async () => {
    const data = [
      { id: 2, title: "b" },
      { id: 1, title: "a" },
    ]
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true, data }))
    vi.stubGlobal("fetch", fetchMock)
    const client = createAnnounceClient({ baseUrl: "https://announce.example" })
    const list = await client.getBanner(3)
    expect(list.map((b) => b.id)).toEqual([2, 1])
    expect(fetchMock).toHaveBeenCalledWith(
      "https://announce.example/api/v1/banner?limit=3",
      expect.anything(),
    )
  })

  it("HTTP 200 でも封筒 ok:false ならエラー(封筒優先の分岐)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          ok: false,
          error: { code: "bad_request", message: "limit must be..." },
        }),
      ),
    )
    const client = createAnnounceClient({ baseUrl: "https://announce.example" })
    const err = await client.getMeta().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AnnounceApiError)
    expect((err as AnnounceApiError).code).toBe("bad_request")
    expect((err as AnnounceApiError).message).toBe("limit must be...")
  })

  it("HTTP 500 + 封筒エラーは status と code を保持する", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          { ok: false, error: { code: "internal", message: "boom" } },
          500,
        ),
      ),
    )
    const client = createAnnounceClient({ baseUrl: "https://announce.example" })
    const err = await client.getMeta().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AnnounceApiError)
    expect((err as AnnounceApiError).status).toBe(500)
    expect((err as AnnounceApiError).code).toBe("internal")
  })

  it("JSON でない body はステータスのみでエラーにする", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response("<html>gateway error</html>", { status: 502 }),
      ),
    )
    const client = createAnnounceClient({ baseUrl: "https://announce.example" })
    const err = await client.getBanner(5).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AnnounceApiError)
    expect((err as AnnounceApiError).status).toBe(502)
    expect((err as AnnounceApiError).code).toBeNull()
  })
})
