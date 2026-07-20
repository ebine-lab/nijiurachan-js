// お知らせバナーのブラウザ側キャッシュ入出力。
// parse/serialize は pure/announce.ts に委譲し、ここは storage アクセスの
// ガード(プライベートブラウジング / SecurityError / 未定義環境)だけを担う。
import {
  type AnnounceCache,
  emptyAnnounceCache,
  parseAnnounceCache,
  serializeAnnounceCache,
} from "../pure/announce"

/** localStorage: meta/banner のキャッシュ(既存の aimg- プレフィックス規約に合わせる) */
export const ANNOUNCE_CACHE_KEY = "aimg-announce"
/** sessionStorage: ✕で閉じたときの bannerRev(セッション単位の非表示) */
export const ANNOUNCE_DISMISSED_KEY = "aimg-announce-dismissed"

export function readAnnounceCache(): AnnounceCache {
  try {
    if (typeof localStorage === "undefined") return emptyAnnounceCache()
    return parseAnnounceCache(localStorage.getItem(ANNOUNCE_CACHE_KEY))
  } catch {
    // getItem が投げる環境では毎回未キャッシュ扱い(マウント毎の再取得に劣化するだけ)
    return emptyAnnounceCache()
  }
}

export function writeAnnounceCache(cache: AnnounceCache): void {
  try {
    if (typeof localStorage === "undefined") return
    localStorage.setItem(ANNOUNCE_CACHE_KEY, serializeAnnounceCache(cache))
  } catch {
    // 書けなくてもウィジェットの動作は継続する
  }
}

export function readDismissedRev(): number | null {
  try {
    if (typeof sessionStorage === "undefined") return null
    const raw = sessionStorage.getItem(ANNOUNCE_DISMISSED_KEY)
    if (raw == null) return null
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

export function writeDismissedRev(rev: number): void {
  try {
    if (typeof sessionStorage === "undefined") return
    sessionStorage.setItem(ANNOUNCE_DISMISSED_KEY, String(rev))
  } catch {
    // 書けない環境ではリロードで再表示されるだけ
  }
}
