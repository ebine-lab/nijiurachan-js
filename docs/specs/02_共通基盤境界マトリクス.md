# 共通基盤境界マトリクス: nijiurachan-js

本ドキュメントは、`nijiurachan-js` に残すべき責務と、
各クライアント repo 側へ置くべき責務を整理する。

## 1. 目的

- 共通基盤 repo の肥大化を防ぐ
- `aimg_viewer` や将来の PC 側実装の都合を直接抱え込まない
- `pure` を中心に再利用可能な核を維持する

## 2. 境界マトリクス

| 領域 | `nijiurachan-js` に置く | クライアント側に置く | 代表ファイル |
| --- | --- | --- | --- |
| 純粋ロジック | 状態遷移、判定、値組み立て | 画面遷移、store 更新 | `src/pure/upfile.ts` |
| Custom Elements | DOM 入口、イベント橋渡し、最低限の lifecycle | page 固有 mount 制御 | `src/elements/upfile-input.ts` |
| Preact components | 汎用 UI 断片 | page レイアウト、アプリ固有 state | `src/components/upfile-input-fragment.tsx` |
| 外部 I/O | popup、paint、既存イベント連携 | API 呼び出し、router、app state | `src/io/axnos-paint-popup.ts` |
| React 橋渡し (汎用) | 要素非依存のブリッジ (`<CustomElementRegion>` / `useEvent` / `useEventLatest` / `useHost`) | アプリ固有のレイアウト・store 接続 | `src/react/PreactWrapperV1/*` |
| util | 汎用イベント / context 補助 | domain 固有 helper | `src/util/*` |
| build | 共有ライブラリとしての build / test 実行 | アプリ bundling / deploy | `src/build/*` |

## 3. 共通基盤に残さないもの

- router
- page 単位 store
- API client の業務ロジック
- app 固有の文言や画面導線
- 特定クライアント専用の feature flag

## 4. 共通基盤に残してよいもの

- 添付入力や paint 連携のような横断 UI 部品
- `pure` で表現できる状態遷移
- DOM / Custom Elements の最小限の橋渡し
- 既存 JS と TS の間で必要なイベント契約

## 5. 現実装で注意すべき箇所

- `src/elements/upfile-input.ts`
  - form / dataset / DOM 状態へ強く依存するため、これ以上 app 固有条件を増やしすぎない
- `src/pure/upfile.ts`
  - 仕様の核なので、ここに mode / action を増やすときはクライアント横断性を先に確認する
- `src/build/tasks/build-and-test.ts`
  - build と test 実行が近いので、運用上は「設計レビュー」と「実行自動化」を混同しない
- `src/react/PreactWrapperV1/`
  - `core/` は要素非依存に保つこと
  - `package.json` の `peerDependenciesMeta` で `react` を optional 扱いに保ち、AI_BBS 側に React を持ち込まない

## 6. 更新ルール

- 新しい部品を追加するときは、本マトリクスで置き場を先に判断する
- `pure` を変更したときは `implementation/TEST_DESIGN.md` の確認観点を合わせて更新する
- クライアント固有都合を持ち込む場合は、まずアプリ側へ置けないかを検討する
