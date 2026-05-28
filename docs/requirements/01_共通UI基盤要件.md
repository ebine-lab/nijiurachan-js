# 共通 UI 基盤要件定義: nijiurachan-js

本ドキュメントは、`nijiurachan-js` を Phase 1 / 3 / 4 の共通基盤として成立させるための要件を定義する。

## 1. 位置づけ

`nijiurachan-js` は、単なる部品置き場ではなく、`AI_BBS/ts` と `aimg_viewer` の間で再利用される UI / 入力 / 補助ロジック基盤である。
Phase 1 の新スマホ版、Phase 3 の PC 版 V2、Phase 4 の PC / SP 統合版 V3 で共有可能な下層資産を保持する。

## 2. 目的

- フロント実装の重複を減らす
- UI 入口、外部連携、純粋ロジックの責務分離を固定する
- 将来のクライアント統合に耐える部品基盤を維持する

## 3. スコープ

### 対象

- Custom Elements
- Preact コンポーネント
- 入出力ラッパ
- 純粋ロジック
- イベント契約
- React アプリ向け橋渡し (`src/react/PreactWrapperV1`)
- ビルド / 配布

### 対象外

- 画面全体のアプリケーション状態管理
- クライアント固有のルーティング
- 画面単位の UX 最適化

## 4. 機能要件

### 4.1 共通基盤の役割

- NJS-REQ-001
  `AI_BBS/ts` と `aimg_viewer` の両方で再利用可能な小さな部品を提供できること。
- NJS-REQ-002
  クライアント固有ロジックよりも、入力、補助 UI、外部部品接続、純粋判定ロジックを優先して切り出すこと。

### 4.2 依存方向

- NJS-REQ-010
  依存方向は `entrypoints -> elements / io -> components -> pure` を維持できること。
- NJS-REQ-011
  `pure` は DOM や通信に依存しないこと。
- NJS-REQ-012
  `elements` と `components` は外部処理を直接抱え込みすぎず、`io` と `pure` に責務を分けられること。

### 4.3 Phase 1 / 3 / 4 拡張前提

- NJS-REQ-020
  Phase 1 の新スマホ版に必要な入力部品や補助部品を供給できること。
- NJS-REQ-021
  Phase 3 の PC 版 V2 でも再利用可能な粒度を優先すること。
- NJS-REQ-022
  Phase 4 の PC / SP 統合版 V3 を阻害するクライアント専用前提を持ち込みすぎないこと。
- NJS-REQ-023
  React 系クライアントから直接使えない部品でも、純粋ロジックと契約は再利用可能に保つこと。
- NJS-REQ-024
  React 系クライアントの都合は `src/react/PreactWrapperV1` で対応する。elements/components 側には React 固有の都合を持ち込まないこと（詳細は [`docs/specs/MEMO_REACT_BRIDGE_DECISION.md`](../specs/MEMO_REACT_BRIDGE_DECISION.md) を参照）。

### 4.4 外部連携

- NJS-REQ-030
  Turnstile、添付入力、お絵描き連携などの外部要素は、クライアント側の画面都合と分離して部品化できること。
- NJS-REQ-031
  既存 JS から TS へ移す際は、イベント連携を使って寿命を延ばしすぎない方針を維持すること。

### 4.5 テスト設計

- NJS-REQ-040
  `pure` の判定ロジックはユニットテスト対象として扱えること。
- NJS-REQ-041
  `elements` / `components` は、`pure` の指示通り動くかを設計レベルで確認できること。

## 5. 非機能要件

- NJS-NFR-001
  ビルド成果物の公開契約は `exports` と自動生成 index により維持できること。
- NJS-NFR-002
  クライアント実装を重く固定しすぎず、共通基盤 repo としてコンパクトであること。
- NJS-NFR-003
  テストは本段階では設計レベルの確認観点に止め、実行やカバレッジ目標は後続とすること。

## 6. 受入条件

- 共通基盤としての役割が明文化されている
- 依存方向と責務分離が要件として固定されている
- Phase 1 / 3 / 4 を受ける前提が要件として説明できる
- Turnstile、添付入力、イベント契約のような代表ユースケースが共通基盤の対象として説明できる
