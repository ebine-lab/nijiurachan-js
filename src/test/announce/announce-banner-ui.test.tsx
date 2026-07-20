/** @jsxImportSource preact */
import { render } from "preact"
import { act } from "preact/test-utils"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  AnnounceBannerUI,
  type AnnounceBannerUIProps,
} from "#js/components/announce-banner-ui"
import type { PublicAnnouncement } from "#js/pure/announce"

let container: HTMLDivElement

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
})

afterEach(() => {
  render(null, container)
  container.remove()
  vi.useRealTimers()
})

function banner(overrides: Partial<PublicAnnouncement>): PublicAnnouncement {
  return {
    id: 1,
    title: "メンテナンスのお知らせ",
    body_md: "",
    body_html: "",
    level: "normal",
    is_pinned: true,
    pinned_order: 0,
    is_banner: true,
    published_at: "2026-07-15T12:00:00Z",
    updated_at: "2026-07-18T18:07:07Z",
    ...overrides,
  }
}

function baseProps(
  overrides: Partial<AnnounceBannerUIProps>,
): AnnounceBannerUIProps {
  return {
    banners: [banner({})],
    href: "https://announce.example/",
    iconSrc: "data:image/svg+xml,x",
    showNewBadge: false,
    theme: "auto",
    rotateIntervalMs: 5000,
    onDismiss: () => {},
    onLinkClick: () => {},
    ...overrides,
  }
}

describe("AnnounceBannerUI — レベル別表示", () => {
  it("emergency は 🚨 前置と lv-emergency クラス", () => {
    render(
      <AnnounceBannerUI
        {...baseProps({
          banners: [banner({ level: "emergency", title: "緊急" })],
        })}
      />,
      container,
    )
    const title = container.querySelector(".aimg-announce-title")
    expect(title?.textContent).toBe("🚨緊急")
    expect(title?.classList.contains("aimg-announce-lv-emergency")).toBe(true)
  })

  it("important は ⭐️ 前置と lv-important クラス", () => {
    render(
      <AnnounceBannerUI
        {...baseProps({
          banners: [banner({ level: "important", title: "推奨" })],
        })}
      />,
      container,
    )
    const title = container.querySelector(".aimg-announce-title")
    expect(title?.textContent).toBe("⭐️推奨")
    expect(title?.classList.contains("aimg-announce-lv-important")).toBe(true)
  })

  it("normal は前置なしで lv-normal クラス", () => {
    render(
      <AnnounceBannerUI
        {...baseProps({
          banners: [banner({ level: "normal", title: "通常" })],
        })}
      />,
      container,
    )
    const title = container.querySelector(".aimg-announce-title")
    expect(title?.textContent).toBe("通常")
    expect(title?.classList.contains("aimg-announce-lv-normal")).toBe(true)
  })
})

describe("AnnounceBannerUI — ローテーション", () => {
  it("1件のときはタイマー経過してもタイトルが変わらない", async () => {
    vi.useFakeTimers()
    // fake timers 下では effect のフラッシュも遅延するため act で確実に実行する
    await act(() => {
      render(<AnnounceBannerUI {...baseProps({})} />, container)
    })
    await act(() => {
      vi.advanceTimersByTime(20_000)
    })
    expect(container.textContent).toContain("メンテナンスのお知らせ")
  })

  it("複数件は間隔ごとに順繰りに表示し末尾で先頭に戻る", async () => {
    vi.useFakeTimers()
    const banners = [
      banner({ id: 1, title: "一つ目" }),
      banner({ id: 2, title: "二つ目" }),
      banner({ id: 3, title: "三つ目" }),
    ]
    await act(() => {
      render(<AnnounceBannerUI {...baseProps({ banners })} />, container)
    })
    expect(container.textContent).toContain("一つ目")
    await act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(container.textContent).toContain("二つ目")
    await act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(container.textContent).toContain("三つ目")
    await act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(container.textContent).toContain("一つ目")
  })

  it("ホバー中はローテーションが止まり、離すと再開する", async () => {
    vi.useFakeTimers()
    const banners = [
      banner({ id: 1, title: "一つ目" }),
      banner({ id: 2, title: "二つ目" }),
    ]
    await act(() => {
      render(<AnnounceBannerUI {...baseProps({ banners })} />, container)
    })
    const root = container.querySelector(".aimg-announce-root") as HTMLElement
    await act(() => {
      root.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false }))
    })
    await act(() => {
      vi.advanceTimersByTime(15_000)
    })
    expect(container.textContent).toContain("一つ目")
    await act(() => {
      root.dispatchEvent(new MouseEvent("mouseleave", { bubbles: false }))
    })
    await act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(container.textContent).toContain("二つ目")
  })
})

describe("AnnounceBannerUI — レベル別持続時間", () => {
  it("emergency は基準+2.5秒表示してから次へ進む", async () => {
    vi.useFakeTimers()
    const banners = [
      banner({ id: 1, title: "緊急", level: "emergency" }),
      banner({ id: 2, title: "次の告知" }),
    ]
    await act(() => {
      render(<AnnounceBannerUI {...baseProps({ banners })} />, container)
    })
    await act(() => {
      vi.advanceTimersByTime(7499)
    })
    expect(container.textContent).not.toContain("次の告知")
    await act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(container.textContent).toContain("次の告知")
  })

  it("important は基準+1.5秒表示してから次へ進む", async () => {
    vi.useFakeTimers()
    const banners = [
      banner({ id: 1, title: "推奨", level: "important" }),
      banner({ id: 2, title: "次の告知" }),
    ]
    await act(() => {
      render(<AnnounceBannerUI {...baseProps({ banners })} />, container)
    })
    await act(() => {
      vi.advanceTimersByTime(6499)
    })
    expect(container.textContent).not.toContain("次の告知")
    await act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(container.textContent).toContain("次の告知")
  })
})

describe("AnnounceBannerUI — クロスフェード", () => {
  it("スワップ直後は新旧タイトルが共存し、フェード完了後に旧が消える", async () => {
    vi.useFakeTimers()
    const banners = [
      banner({ id: 1, title: "一つ目" }),
      banner({ id: 2, title: "二つ目" }),
    ]
    await act(() => {
      render(<AnnounceBannerUI {...baseProps({ banners })} />, container)
    })
    await act(() => {
      vi.advanceTimersByTime(5000)
    })
    // クロスフェード中: 旧(is-leaving)と新(is-entering)が重なって存在する
    const leaving = container.querySelector(".aimg-announce-title.is-leaving")
    const entering = container.querySelector(".aimg-announce-title.is-entering")
    expect(leaving?.textContent).toBe("一つ目")
    expect(entering?.textContent).toBe("二つ目")
    // フェード完了(0.7s)後は旧タイトルが破棄される
    await act(() => {
      vi.advanceTimersByTime(700)
    })
    expect(
      container.querySelector(".aimg-announce-title.is-leaving"),
    ).toBeNull()
    expect(container.textContent).not.toContain("一つ目")
  })

  it("初期表示ではフェードインしない(is-entering が付かない)", async () => {
    vi.useFakeTimers()
    await act(() => {
      render(<AnnounceBannerUI {...baseProps({})} />, container)
    })
    expect(
      container.querySelector(".aimg-announce-title.is-entering"),
    ).toBeNull()
  })
})

describe("AnnounceBannerUI — 操作", () => {
  it("✕クリックで onDismiss が呼ばれナビゲーションは抑止される", () => {
    const onDismiss = vi.fn()
    const onLinkClick = vi.fn()
    render(
      <AnnounceBannerUI {...baseProps({ onDismiss, onLinkClick })} />,
      container,
    )
    const close = container.querySelector(
      ".aimg-announce-close",
    ) as HTMLButtonElement
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true })
    close.dispatchEvent(ev)
    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(ev.defaultPrevented).toBe(true)
    // stopPropagation により外側リンクのクリック扱いにならない
    expect(onLinkClick).not.toHaveBeenCalled()
  })

  it("バナー本体クリックで onLinkClick が呼ばれる(遷移は抑止しない)", () => {
    const onLinkClick = vi.fn()
    render(<AnnounceBannerUI {...baseProps({ onLinkClick })} />, container)
    const root = container.querySelector(
      ".aimg-announce-root",
    ) as HTMLAnchorElement
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true })
    root.dispatchEvent(ev)
    expect(onLinkClick).toHaveBeenCalledTimes(1)
    expect(ev.defaultPrevented).toBe(false)
  })

  it("showNewBadge に応じて new バッジが出る", () => {
    render(
      <AnnounceBannerUI {...baseProps({ showNewBadge: true })} />,
      container,
    )
    expect(container.querySelector(".aimg-announce-badge")?.textContent).toBe(
      "new",
    )
    render(
      <AnnounceBannerUI {...baseProps({ showNewBadge: false })} />,
      container,
    )
    expect(container.querySelector(".aimg-announce-badge")).toBeNull()
  })

  it("theme プロップが data-theme 属性に反映される", () => {
    render(<AnnounceBannerUI {...baseProps({ theme: "dark" })} />, container)
    const root = container.querySelector(".aimg-announce-root") as HTMLElement
    expect(root.dataset.theme).toBe("dark")
  })

  it("href とアイコン src が反映される", () => {
    render(<AnnounceBannerUI {...baseProps({})} />, container)
    const root = container.querySelector(
      ".aimg-announce-root",
    ) as HTMLAnchorElement
    expect(root.href).toBe("https://announce.example/")
    const icon = container.querySelector(
      ".aimg-announce-icon",
    ) as HTMLImageElement
    expect(icon.getAttribute("src")).toBe("data:image/svg+xml,x")
  })
})
