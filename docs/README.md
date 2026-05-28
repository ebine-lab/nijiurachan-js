# nijiurachan-js ドキュメント入口

本ディレクトリは、`nijiurachan-js` の役割、要件、設計、実装準備文書の入口として扱う。
ルート README は概要説明として残しつつ、共通基盤としての正本は本ディレクトリに集約する。

## 1. 読み順と各文書の位置づけ

1. [`docs/README.md`](./README.md): リポジトリ概要
2. [`docs/BIRDSEYE.md`](./BIRDSEYE.md): 全体像
3. [`docs/requirements/01_共通UI基盤要件.md`](./requirements/01_共通UI基盤要件.md): Phase 1 / 3 / 4 を支える共通基盤要件
4. [`docs/specs/01_Phase1〜Phase4アーキテクチャ.md`](./specs/01_Phase1〜Phase4アーキテクチャ.md): Preact / Custom Elements と将来クライアントの境界を定義する設計方針
5. [`docs/specs/02_共通基盤境界マトリクス.md`](./specs/02_共通基盤境界マトリクス.md): 共通基盤に残すものと各アプリ側へ出すものの境界整理
6. [`docs/specs/03_Reactブリッジ設計メモ.md`](./specs/03_Reactブリッジ設計メモ.md): PreactWrapperV1 設計時、ラッパーという形式を選んだことについての考察
7. [`docs/operations/01_RUNBOOK.md`](./operations/01_RUNBOOK.md): 運用・公開・更新時の判断入口
8. [`docs/operations/02_実装ボトルネックレビュー.md`](./operations/02_実装ボトルネックレビュー.md): 共通基盤として崩れやすい箇所の優先度レビュー
9. [`docs/implementation/01_テスト設計.md`](./implementation/01_テスト設計.md): 設計レベルの確認観点
10. [`docs/implementation/02_ReactブリッジPreactWrapperV1.md`](./implementation/02_ReactブリッジPreactWrapperV1.md): React アプリ向け橋渡し `PreactWrapperV1` の説明書
11. [`README.md`](../README.md): リポジトリ概要
12. [`src/README.md`](../src/README.md): 現行の依存方向と開発スタイルの設計メモ

## 2. 正本ドキュメント

- 要件正本: [`docs/requirements/01_共通UI基盤要件.md`](./requirements/01_共通UI基盤要件.md)
- アーキテクチャ正本: [`docs/specs/01_Phase1〜Phase4アーキテクチャ.md`](./specs/01_Phase1〜Phase4アーキテクチャ.md)
- 境界整理: [`docs/specs/02_共通基盤境界マトリクス.md`](./specs/02_共通基盤境界マトリクス.md)

## 3. 入口ドキュメント

- 俯瞰入口: [`docs/BIRDSEYE.md`](./BIRDSEYE.md)
- docs 入口: `docs/README.md` (本ドキュメント)
- 運用入口: [`docs/operations/01_RUNBOOK.md`](./operations/01_RUNBOOK.md)
- 実装レビュー入口: [`docs/operations/02_実装ボトルネックレビュー.md`](./operations/02_実装ボトルネックレビュー.md)
- 確認観点入口: [`docs/implementation/01_テスト設計.md`](./implementation/01_テスト設計.md)

## 4. 更新順

1. 要件変更
2. アーキテクチャ方針更新
3. 境界マトリクス / ボトルネックレビュー更新
4. テスト設計 / Runbook 更新
5. README / Birdseye / Hub 同期
