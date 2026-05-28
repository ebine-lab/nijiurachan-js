# テスト設計メモ

本ドキュメントは、`nijiurachan-js` の設計レベルの確認観点を整理する。

## 1. 基本方針

- テストは本段階では設計レベルに止める
- `pure` のロジックを最優先で確認する
- `elements` / `components` は `pure` と契約通り接続されるかを確認する

## 2. 確認観点

### 2.1 pure

- 状態遷移が想定通りか
- 入出力がクライアント非依存であるか
- DOM や通信に依存していないか

### 2.2 elements

- lifecycle で必要な初期化が行われるか
- form association や custom element 登録が正しいか
- 外部スクリプトや要素依存が過剰でないか

### 2.3 components

- `pure` の判定を表示へ正しく反映できるか
- `io` との接続が UI 固有都合に寄りすぎていないか

### 2.4 io / util

- 外部部品との橋渡しが局所化されているか
- カスタムイベント契約が崩れていないか

### 2.5 react (PreactWrapperV1)

- generic 部 (`PreactWrapperV1/` 直下と `core/`) が要素のイベント名・属性・method を知らない状態を保てているか
- AI_BBS (素の Web Components) と aimg_viewer (React 経由) で同じ host method / CustomEvent を使う API 対称性が崩れていないか
- 内部 DOM 破壊耐性 (`<canvas id=oejs>` を外部 JS が `remove()` しても React が落ちない) が保てているか

## 3. 将来自動化候補

- `pure/upfile.ts` のような状態遷移系
- Turnstile まわりの最低限の契約
- 添付入力の mode 遷移
- PreactWrapperV1 の遅延リスナ (購読要求 0 になったら `removeEventListener`) と `LatestEventDetailProvider` の pull 経路
