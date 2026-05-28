# nijiurachan-js Runbook

本ドキュメントは、`nijiurachan-js` の更新、公開、利用判断の入口である。

## 1. 参照順

- [`docs/README.md`](../README.md)を参照

## 2. 運用上の要点

- この repo はアプリ本体ではなく共通基盤である
- クライアント固有要求より、横断再利用を優先する
- `pure` の再利用性を最重要に扱う

## 3. 更新時に確認すること

- 依存方向が崩れていないか (`react` 層追加後も `react → elements/components/pure` の片方向)
- `pure` に DOM や通信が入っていないか
- 新しい部品が `AI_BBS/ts` と `aimg_viewer` のどちらにも役立つか
- クライアント専用都合をこの repo に持ち込みすぎていないか
- `PreactWrapperV1/` 直下に要素ごとの知識 (タグ名 / イベント名 / method) を持ち込んでいないか

## 4. 今後詰めること

- Turnstile / 添付入力 / paint 連携の共通契約
- どこまでを共通基盤へ寄せ、どこからをアプリ側に残すかの運用線
- 直近レビューは `docs/operations/IMPLEMENTATION_BOTTLENECK_REVIEW.md` を参照する

## 5. 更新ルール

- 要件と設計の正本は `requirements` / `specs` 側に置く
- Runbook には利用判断と更新時の確認ポイントのみを寄せる
