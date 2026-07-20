/** @jsxImportSource preact */
import type { VNode } from "preact"
import { useEffect, useState } from "preact/hooks"
import {
  levelClass,
  levelPrefix,
  nextBannerIndex,
  type PublicAnnouncement,
} from "../pure/announce"

export interface AnnounceBannerUIProps {
  /** サーバーソート済みのバナー一覧(≤5件)。空配列のときは要素側で描画しない前提 */
  banners: PublicAnnouncement[]
  /** バナー全体のリンク先(告知サイトのトップ) */
  href: string
  iconSrc: string
  /** 未読記事バッジ(アイコン右上の「new」)を出すか */
  showNewBadge: boolean
  theme: "light" | "dark" | "auto"
  /** タイトルローテーション間隔(ms)。複数件のときのみ使われる */
  rotateIntervalMs: number
  /** ✕押下。ナビゲーションはこの中で抑止済み */
  onDismiss: () => void
  /** リンククリック(既読記録用)。preventDefault せず遷移はそのまま進む */
  onLinkClick: () => void
}

function prefersReducedMotion(): boolean {
  return (
    typeof matchMedia !== "undefined" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
  )
}

export function AnnounceBannerUI(props: AnnounceBannerUIProps): VNode {
  const {
    banners,
    href,
    iconSrc,
    showNewBadge,
    theme,
    rotateIntervalMs,
    onDismiss,
    onLinkClick,
  } = props
  const [index, setIndex] = useState(0)
  const [hovered, setHovered] = useState(false)

  useEffect(() => {
    // 1件以下・ホバー中・motion 低減設定ではローテーションしない
    if (banners.length <= 1 || hovered || prefersReducedMotion()) return
    const timer = setInterval(() => {
      setIndex((i) => nextBannerIndex(i, banners.length))
    }, rotateIntervalMs)
    return () => clearInterval(timer)
  }, [banners.length, hovered, rotateIntervalMs])

  // 再取得でリストが縮んでも範囲外を描画しないようにクランプ
  const item = banners[banners.length > 0 ? index % banners.length : 0]

  return (
    <a
      class="aimg-announce-root"
      data-theme={theme}
      href={href}
      aria-label={item != null ? `お知らせ: ${item.title}` : "お知らせ"}
      onClick={() => onLinkClick()}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span class="aimg-announce-icon-wrap">
        <img
          class="aimg-announce-icon"
          src={iconSrc}
          alt=""
          width={28}
          height={28}
        />
        {showNewBadge && <span class="aimg-announce-badge">new</span>}
      </span>
      {item != null && (
        <span
          class={`aimg-announce-title ${levelClass(item.level)}`}
          aria-live="polite"
        >
          {levelPrefix(item.level)}
          {item.title}
        </span>
      )}
      <button
        type="button"
        class="aimg-announce-close"
        aria-label="お知らせを閉じる"
        onClick={(e: Event) => {
          // 外側の <a> への伝播とナビゲーションを止めてから閉じる
          e.preventDefault()
          e.stopPropagation()
          onDismiss()
        }}
      >
        ✕
      </button>
    </a>
  )
}
