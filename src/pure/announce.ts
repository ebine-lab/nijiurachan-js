// aimg-notify(告知バックエンド)連携の型と純粋判定ロジック。
// API 契約は aimg-notify リポジトリの docs/frontend-integration/README.md を参照。
// DOM・ストレージ・時刻には触れない(now は引数で注入する)。

export type AnnounceLevel = "normal" | "important" | "emergency"

/** GET /api/v1/banner の各要素(公開 API の PublicAnnouncement) */
export interface PublicAnnouncement {
  id: number
  title: string
  body_md: string
  body_html: string
  level: AnnounceLevel
  is_pinned: boolean
  pinned_order: number | null
  is_banner: boolean
  published_at: string | null
  updated_at: string
}

/** GET /api/v1/meta のレスポンス data */
export interface AnnounceMeta {
  /** 記事チャンネルの最新初回公開日時(ISO 8601 UTC)。公開告知ゼロなら null。前進のみ */
  article: string | null
  /** バナーラインナップのリビジョン番号。前回値との一致/不一致だけに意味がある */
  banner: number
}

/** localStorage にキャッシュする状態(単一キーに JSON で保存) */
export interface AnnounceCache {
  /** 最後に /meta を叩いた時刻(epoch ms)。60秒スロットルの基準 */
  lastMetaFetchedAt: number | null
  /** ユーザーが告知サイトへ遷移した時点の article 値(=既読の最新記事状態) */
  seenArticle: string | null
  /** 最後に取得した meta.article。meta フェッチをスキップしたマウントでもバッジ判定に使う */
  article: string | null
  /** banners を取得したときの meta.banner 値 */
  bannerRev: number | null
  /** GET /api/v1/banner の結果(サーバーソート済み) */
  banners: PublicAnnouncement[] | null
}

export const META_FETCH_INTERVAL_MS = 60_000

export function emptyAnnounceCache(): AnnounceCache {
  return {
    lastMetaFetchedAt: null,
    seenArticle: null,
    article: null,
    bannerRev: null,
    banners: null,
  }
}

/** 過去60秒以内に /meta を叩いていなければ true(仕様: 60秒以上の間隔で叩く) */
export function shouldFetchMeta(
  lastMetaFetchedAtMs: number | null,
  nowMs: number,
): boolean {
  if (lastMetaFetchedAtMs == null) return true
  return nowMs - lastMetaFetchedAtMs >= META_FETCH_INTERVAL_MS
}

/**
 * バナー一覧を再取得すべきか。リビジョンは単調増加だが「変わったか」だけを見る
 * (大小比較はしない)。meta が取れていない(metaRev == null)ときはキャッシュ維持。
 */
export function shouldRefetchBanner(
  cachedRev: number | null,
  metaRev: number | null,
  hasCachedList: boolean,
): boolean {
  if (metaRev == null) return false
  return cachedRev !== metaRev || !hasCachedList
}

/**
 * 未読記事バッジを出すか。article は同一サーバー発行の ISO 8601 で前進のみのため、
 * Date 解釈をせず文字列不一致だけで「進んだ」とみなせる。
 */
export function hasNewArticle(
  seenArticle: string | null,
  article: string | null,
): boolean {
  if (article == null) return false
  return article !== seenArticle
}

/** ✕で閉じた rev と現在の rev が一致している間だけ非表示(ラインナップが変われば再表示) */
export function isDismissed(
  dismissedRev: number | null,
  currentRev: number | null,
): boolean {
  return dismissedRev != null && dismissedRev === currentRev
}

/** ローテーションの次インデックス(末尾で先頭に戻る) */
export function nextBannerIndex(index: number, length: number): number {
  if (length <= 0) return 0
  return (index + 1) % length
}

/** レベルに応じた表示持続時間の加算値(重要な告知ほど長く見せる) */
export const LEVEL_EXTRA_DURATION_MS: Record<AnnounceLevel, number> = {
  normal: 0,
  important: 1500,
  emergency: 2500,
}

/** 現在表示中アイテムの表示持続時間(基準値 + レベル別加算) */
export function rotateDurationMs(baseMs: number, level: AnnounceLevel): number {
  return baseMs + LEVEL_EXTRA_DURATION_MS[level]
}

/** レベルに応じたタイトル前置アイコン */
export function levelPrefix(level: AnnounceLevel): string {
  if (level === "emergency") return "🚨"
  if (level === "important") return "⭐️"
  return ""
}

/** レベルに応じた CSS 修飾クラス */
export function levelClass(level: AnnounceLevel): string {
  return `aimg-announce-lv-${level}`
}

function isLevel(v: unknown): v is AnnounceLevel {
  return v === "normal" || v === "important" || v === "emergency"
}

function isPublicAnnouncement(v: unknown): v is PublicAnnouncement {
  if (typeof v !== "object" || v == null) return false
  const o = v as Record<string, unknown>
  return (
    typeof o.id === "number" &&
    typeof o.title === "string" &&
    isLevel(o.level) &&
    (o.published_at == null || typeof o.published_at === "string") &&
    typeof o.updated_at === "string"
  )
}

/**
 * localStorage の生文字列からキャッシュを復元する。
 * 壊れた JSON・型不一致はフィールド単位で捨てて既定値に矯正する(例外は投げない)。
 */
export function parseAnnounceCache(raw: string | null): AnnounceCache {
  const cache = emptyAnnounceCache()
  if (raw == null) return cache
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return cache
  }
  if (typeof parsed !== "object" || parsed == null || Array.isArray(parsed)) {
    return cache
  }
  const o = parsed as Record<string, unknown>
  if (
    typeof o.lastMetaFetchedAt === "number" &&
    Number.isFinite(o.lastMetaFetchedAt)
  ) {
    cache.lastMetaFetchedAt = o.lastMetaFetchedAt
  }
  if (typeof o.seenArticle === "string") cache.seenArticle = o.seenArticle
  if (typeof o.article === "string") cache.article = o.article
  if (typeof o.bannerRev === "number" && Number.isFinite(o.bannerRev)) {
    cache.bannerRev = o.bannerRev
  }
  if (Array.isArray(o.banners) && o.banners.every(isPublicAnnouncement)) {
    cache.banners = o.banners
  }
  return cache
}

export function serializeAnnounceCache(cache: AnnounceCache): string {
  return JSON.stringify(cache)
}
