/** @jsxImportSource preact */
import type { VNode } from "preact"
import { useEffect, useState } from "preact/hooks"
import {
  levelClass,
  levelPrefix,
  nextBannerIndex,
  type PublicAnnouncement,
  rotateDurationMs,
} from "../pure/announce"

// クロスフェード: 旧 0.5s フェードアウト / 新 0.2s 遅延 + 0.5s フェードイン(重なり 0.3s)。
// 旧タイトル span はアニメーション完了(0.5s)後に破棄する。
const CROSS_FADE_TOTAL_MS = 700

export interface AnnounceBannerUIProps {
  /** サーバーソート済みのバナー一覧(≤5件)。空配列のときは要素側で描画しない前提 */
  banners: PublicAnnouncement[]
  /** バナー全体のリンク先(告知サイトのトップ) */
  href: string
  iconSrc: string
  /** 未読記事バッジ(アイコン右上の「new」)を出すか */
  showNewBadge: boolean
  theme: "light" | "dark" | "auto"
  /** normal レベルの表示持続時間(ms)。important/emergency はレベル別に加算される */
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

function titleSpan(
  item: PublicAnnouncement,
  phase: "entering" | "leaving" | null,
): VNode {
  const phaseClass =
    phase === "entering"
      ? " is-entering"
      : phase === "leaving"
        ? " is-leaving"
        : ""
  return (
    <span
      key={item.id}
      class={`aimg-announce-title ${levelClass(item.level)}${phaseClass}`}
    >
      {levelPrefix(item.level)}
      {item.title}
    </span>
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
  const [prevItem, setPrevItem] = useState<PublicAnnouncement | null>(null)
  const [hovered, setHovered] = useState(false)

  // 再取得でリストが縮んでも範囲外を描画しないようにクランプ
  const item = banners[banners.length > 0 ? index % banners.length : 0]

  // 表示中アイテムのレベルに応じた持続時間で次のスワップを1回分だけ予約する
  // (setInterval ではなく setTimeout チェーン)。
  useEffect(() => {
    // 1件以下・ホバー中・motion 低減設定ではローテーションしない
    if (banners.length <= 1 || hovered || prefersReducedMotion()) return
    if (item == null) return
    const timer = setTimeout(
      () => {
        setPrevItem(item)
        setIndex((i) => nextBannerIndex(i, banners.length))
      },
      rotateDurationMs(rotateIntervalMs, item.level),
    )
    return () => clearTimeout(timer)
  }, [banners, hovered, rotateIntervalMs, item])

  // クロスフェード終了後に旧タイトルを破棄する
  useEffect(() => {
    if (prevItem == null) return
    const timer = setTimeout(() => setPrevItem(null), CROSS_FADE_TOTAL_MS)
    return () => clearTimeout(timer)
  }, [prevItem])

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
          width={32}
          height={32}
        />
        {showNewBadge && <span class="aimg-announce-badge">new</span>}
      </span>
      <span class="aimg-announce-titles" aria-live="polite">
        {prevItem != null && titleSpan(prevItem, "leaving")}
        {item != null && titleSpan(item, prevItem != null ? "entering" : null)}
      </span>
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
