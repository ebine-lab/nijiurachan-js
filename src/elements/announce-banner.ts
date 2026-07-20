import { h, render } from "preact"
import { AnnounceBannerUI } from "../components/announce-banner-ui"
import type { AnnounceClient } from "../io/announce-api"
import { createAnnounceClient } from "../io/announce-api"
import {
  readAnnounceCache,
  readDismissedRev,
  writeAnnounceCache,
  writeDismissedRev,
} from "../io/announce-store"
import type { AnnounceCache } from "../pure/announce"
import {
  hasNewArticle,
  isDismissed,
  shouldFetchMeta,
  shouldRefetchBanner,
} from "../pure/announce"
import { ANNOUNCE_ICON_DATA_URI } from "../pure/announce-icon"
import { ANNOUNCE_CSS, ANNOUNCE_STYLE_ID } from "../pure/announce-style"

// 本番の告知サイト。dev 等では data-api-base 属性で差し替える
// (仕様上 window.location.origin からの派生は禁止)。
const DEFAULT_BASE_URL = "https://announce.nijiurachan.net"
const BANNER_FETCH_LIMIT = 5
const DEFAULT_ROTATE_INTERVAL_MS = 5000
const MIN_ROTATE_INTERVAL_MS = 2000

type Theme = "light" | "dark" | "auto"

function parseTheme(raw: string | null): Theme {
  return raw === "light" || raw === "dark" ? raw : "auto"
}

function parseRotateInterval(raw: string | null): number {
  const n = raw == null ? Number.NaN : Number(raw)
  if (!Number.isFinite(n)) return DEFAULT_ROTATE_INTERVAL_MS
  return Math.max(n, MIN_ROTATE_INTERVAL_MS)
}

/** 複数インスタンスでも <style> は document.head に1つだけ注入する */
function injectStyleOnce(): void {
  if (document.getElementById(ANNOUNCE_STYLE_ID) != null) return
  const style = document.createElement("style")
  style.id = ANNOUNCE_STYLE_ID
  style.textContent = ANNOUNCE_CSS
  document.head.appendChild(style)
}

/**
 * お知らせバナー。aimg-notify の告知をローテーション表示し、全体が告知サイトへのリンク。
 *
 * 使い方: `AnnounceBannerElement.define()` 後に
 * `<announce-banner data-api-base="https://announce.nijiurachan.net"></announce-banner>`
 *
 * 属性:
 * - data-api-base: API と遷移先のオリジン(既定: 本番 URL)
 * - icon-src: 左端アイコンの差し替え
 * - theme: "light" | "dark" | "auto"(既定 auto = prefers-color-scheme 追従)
 * - rotate-interval: タイトルローテーション間隔 ms(既定 5000、下限 2000)
 */
export class AnnounceBannerElement extends HTMLElement {
  #client: AnnounceClient | null = null
  #cache: AnnounceCache = {
    lastMetaFetchedAt: null,
    seenArticle: null,
    article: null,
    bannerRev: null,
    banners: null,
  }
  #dismissed = false
  #abortController: AbortController | null = null
  #baseUrl = DEFAULT_BASE_URL
  #iconSrc = ANNOUNCE_ICON_DATA_URI
  #theme: Theme = "auto"
  #rotateIntervalMs = DEFAULT_ROTATE_INTERVAL_MS

  static define(): void {
    customElements.define("announce-banner", AnnounceBannerElement)
  }

  connectedCallback(): void {
    injectStyleOnce()
    this.#baseUrl = this.getAttribute("data-api-base") ?? DEFAULT_BASE_URL
    this.#iconSrc = this.getAttribute("icon-src") ?? ANNOUNCE_ICON_DATA_URI
    this.#theme = parseTheme(this.getAttribute("theme"))
    this.#rotateIntervalMs = parseRotateInterval(
      this.getAttribute("rotate-interval"),
    )
    this.#client = createAnnounceClient({ baseUrl: this.#baseUrl })
    this.#cache = readAnnounceCache()
    this.#dismissed = isDismissed(readDismissedRev(), this.#cache.bannerRev)
    // まずキャッシュから即描画し、必要なら裏でフェッチして再描画する
    this.#renderUI()
    void this.#init()
  }

  disconnectedCallback(): void {
    this.#abortController?.abort()
    this.#abortController = null
    render(null, this)
  }

  async #init(): Promise<void> {
    const client = this.#client
    if (client == null) return
    this.#abortController?.abort()
    const abort = new AbortController()
    this.#abortController = abort
    try {
      const now = Date.now()
      if (shouldFetchMeta(this.#cache.lastMetaFetchedAt, now)) {
        const meta = await client.getMeta(abort.signal)
        this.#cache.lastMetaFetchedAt = now
        this.#cache.article = meta.article
        writeAnnounceCache(this.#cache)
        if (
          shouldRefetchBanner(
            this.#cache.bannerRev,
            meta.banner,
            this.#cache.banners != null,
          )
        ) {
          const banners = await client.getBanner(
            BANNER_FETCH_LIMIT,
            abort.signal,
          )
          this.#cache.bannerRev = meta.banner
          this.#cache.banners = banners
          writeAnnounceCache(this.#cache)
          // ラインナップが変わったので、閉じたままにするかを新しい rev で判定し直す
          this.#dismissed = isDismissed(readDismissedRev(), meta.banner)
        }
      } else if (this.#cache.banners == null) {
        // meta は60秒スロットル内でスキップしたが、前回バナー取得だけ失敗して
        // リストが無い場合は取り直す(rev は据え置き。次回の meta 比較で正される)
        const banners = await client.getBanner(BANNER_FETCH_LIMIT, abort.signal)
        this.#cache.banners = banners
        writeAnnounceCache(this.#cache)
      }
    } catch (e) {
      if (abort.signal.aborted) return
      // ホストページを壊さない: 失敗時はキャッシュのまま静かに描画を続ける
      console.warn("announce-banner: 告知の取得に失敗しました", e)
    }
    if (abort.signal.aborted) return
    this.#renderUI()
  }

  #renderUI(): void {
    const banners = this.#cache.banners ?? []
    if (this.#dismissed || banners.length === 0) {
      render(null, this)
      return
    }
    render(
      h(AnnounceBannerUI, {
        banners,
        href: `${this.#baseUrl.replace(/\/+$/, "")}/`,
        iconSrc: this.#iconSrc,
        showNewBadge: hasNewArticle(
          this.#cache.seenArticle,
          this.#cache.article,
        ),
        theme: this.#theme,
        rotateIntervalMs: this.#rotateIntervalMs,
        onDismiss: (): void => {
          if (this.#cache.bannerRev != null) {
            writeDismissedRev(this.#cache.bannerRev)
          }
          this.#dismissed = true
          this.#renderUI()
        },
        onLinkClick: (): void => {
          // 告知サイトはクロスオリジンで訪問検知できないため、
          // 遷移前に同期で「この article までは確認済み」を記録する
          this.#cache.seenArticle = this.#cache.article
          writeAnnounceCache(this.#cache)
        },
      }),
      this,
    )
  }
}
