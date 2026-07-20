// お知らせバナーの自己完結スタイル。
// このリポジトリの他コンポーネントは「クラス名だけ出してCSSはホスト任せ」だが、
// announce-banner は複数ホスト(AI_BBS PC / frontend-v1)で同一の見た目を保証するため、
// 要素側が <style id={ANNOUNCE_STYLE_ID}> を document.head に1回だけ注入する。

export const ANNOUNCE_STYLE_ID = "aimg-announce-style"

// テーマはCSSカスタムプロパティで切替:
//   light(既定): 白背景 / normal=青みの黒, important=黄みの黒, emergency=ワインレッド
//   dark:        黒背景 / normal=ライトブルー, important=クリーム, emergency=ピンク
// theme="auto" のときだけ prefers-color-scheme に追従する。
const DARK_VARS = `
  --aimg-announce-bg: #111111;
  --aimg-announce-border: rgba(255, 255, 255, 0.2);
  --aimg-announce-fg-normal: #9ecbff;
  --aimg-announce-fg-important: #f3e5c0;
  --aimg-announce-fg-emergency: #ff9db4;
`

export const ANNOUNCE_CSS = `
.aimg-announce-root {
  --aimg-announce-bg: #ffffff;
  --aimg-announce-border: rgba(0, 0, 0, 0.15);
  --aimg-announce-fg-normal: #232f45;
  --aimg-announce-fg-important: #4d4000;
  --aimg-announce-fg-emergency: #8b1a2f;

  position: relative;
  display: flex;
  align-items: center;
  box-sizing: border-box;
  max-width: 100%;
  /* アイコン32px + 縦4px×2 + 枠1px×2 = 高さ42px(アイコン28px時代と同じ) */
  padding: 4px 30px 4px 10px;
  border: 1px solid var(--aimg-announce-border);
  border-radius: 10px;
  background: var(--aimg-announce-bg);
  color: var(--aimg-announce-fg-normal);
  font-size: 14px;
  line-height: 1.4;
  overflow: hidden;
}
.aimg-announce-link {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  color: inherit;
  text-decoration: none;
}
.aimg-announce-root[data-theme="dark"] {${DARK_VARS}}
@media (prefers-color-scheme: dark) {
  .aimg-announce-root[data-theme="auto"] {${DARK_VARS}}
}
.aimg-announce-icon-wrap {
  position: relative;
  flex: none;
  width: 32px;
  height: 32px;
}
.aimg-announce-icon {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.aimg-announce-badge {
  position: absolute;
  top: -5px;
  right: -7px;
  padding: 0 3px;
  border-radius: 6px;
  background: #e5484d;
  color: #ffffff;
  font-size: 9px;
  font-weight: bold;
  line-height: 1.4;
  pointer-events: none;
}
.aimg-announce-titles {
  position: relative;
  flex: 1;
  min-width: 0;
  height: 1.4em;
}
.aimg-announce-title {
  position: absolute;
  inset: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
/* クロスフェード: 旧タイトルは 0〜0.5s でフェードアウト、
   新タイトルは 0.2s 遅れて 0.5s かけてフェードイン(重なり 0.3s) */
@keyframes aimg-announce-fade-out {
  from { opacity: 1; }
  to { opacity: 0; }
}
@keyframes aimg-announce-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
.aimg-announce-title.is-leaving {
  animation: aimg-announce-fade-out 0.5s ease forwards;
}
.aimg-announce-title.is-entering {
  animation: aimg-announce-fade-in 0.5s ease 0.2s backwards;
}
@media (prefers-reduced-motion: reduce) {
  .aimg-announce-title.is-leaving,
  .aimg-announce-title.is-entering {
    animation: none;
  }
  .aimg-announce-title.is-leaving {
    opacity: 0;
  }
}
.aimg-announce-lv-normal { color: var(--aimg-announce-fg-normal); }
.aimg-announce-lv-important { color: var(--aimg-announce-fg-important); }
.aimg-announce-lv-emergency { color: var(--aimg-announce-fg-emergency); }
.aimg-announce-close {
  position: absolute;
  top: 50%;
  right: 5px;
  transform: translateY(-50%);
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: rgba(128, 128, 128, 0.35);
  color: #ffffff;
  font-size: 12px;
  line-height: 20px;
  text-align: center;
  cursor: pointer;
}
.aimg-announce-close:hover {
  background: rgba(128, 128, 128, 0.55);
}
`
