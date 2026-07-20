// aimg-notify(告知バックエンド)の公開 API クライアント。
// 契約: aimg-notify リポジトリ docs/frontend-integration/README.md
//   - すべて GET / CORS 全開放 / credentials 禁止
//   - 封筒 {ok:true, data} / {ok:false, error:{code,message}}。ok フィールドで分岐する
import type { AnnounceMeta, PublicAnnouncement } from "../pure/announce"

export interface AnnounceClientOptions {
  /** 例: "https://announce.nijiurachan.net"。ハードコード禁止のため呼び出し側が注入する */
  baseUrl: string
}

export class AnnounceApiError extends Error {
  status: number
  /** 封筒 error.code("bad_request" | "not_found" | "internal" など)。取れなければ null */
  code: string | null
  constructor(status: number, code: string | null, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

interface Envelope {
  ok?: boolean
  data?: unknown
  error?: { code?: string; message?: string }
}

/**
 * 封筒を解析して data を返す。HTTP 200 でも ok:false ならエラーにする
 * (未定義パスの404等も封筒形式で返るため、status だけでは分岐しない)。
 */
async function unwrap<T>(res: Response): Promise<T> {
  let body: Envelope | null = null
  try {
    body = (await res.json()) as Envelope
  } catch {
    // JSON でない body はそのまま HTTP ステータスで報告
  }
  if (body?.ok === true && !res.ok) {
    // 封筒は ok でも HTTP がエラー: 通常起こらないが HTTP を優先
    throw new AnnounceApiError(res.status, null, `HTTP ${res.status}`)
  }
  if (body?.ok === true) return body.data as T
  const code = body?.error?.code ?? null
  const message = body?.error?.message ?? `HTTP ${res.status}`
  throw new AnnounceApiError(res.status, code, message)
}

export interface AnnounceClient {
  /** GET /api/v1/meta(~70B の軽量ポーリング先。60秒以上の間隔で呼ぶこと) */
  getMeta(signal?: AbortSignal): Promise<AnnounceMeta>
  /** GET /api/v1/banner?limit=N(サーバーソート済み。再ソート不要) */
  getBanner(limit: number, signal?: AbortSignal): Promise<PublicAnnouncement[]>
}

export function createAnnounceClient({
  baseUrl,
}: AnnounceClientOptions): AnnounceClient {
  // 末尾スラッシュを除去して //api/... になる URL パターンを防ぐ
  const base = baseUrl.replace(/\/+$/, "")
  return {
    async getMeta(signal?: AbortSignal): Promise<AnnounceMeta> {
      const res = await fetch(`${base}/api/v1/meta`, {
        method: "GET",
        credentials: "omit",
        signal,
      })
      return unwrap<AnnounceMeta>(res)
    },

    async getBanner(
      limit: number,
      signal?: AbortSignal,
    ): Promise<PublicAnnouncement[]> {
      const qs = `?limit=${encodeURIComponent(String(limit))}`
      const res = await fetch(`${base}/api/v1/banner${qs}`, {
        method: "GET",
        credentials: "omit",
        signal,
      })
      return unwrap<PublicAnnouncement[]>(res)
    },
  }
}
