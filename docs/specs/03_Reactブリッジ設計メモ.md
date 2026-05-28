# MEMO: React Bridge — PreactWrapperV1 vs preact/compat

PreactWrapperV1 設計時、ラッパーという形式を選んだことについての考察をここにメモします。あくまで導入者の判断であり、今後V2などでは他の方法へと移行される可能性があります。

**Status**: Accepted (現条件下での Pareto 最適。将来の Reconsider トリガを §5 に明記)
**Date**: 2026-04-26
**Decision**: 現行 `PreactWrapperV1` (Custom Element 介在ブリッジ) を継続採用する

---

## Context

`src/react/PreactWrapperV1/` は、Custom Element (内部 Preact 描画) を React VDOM の **外側** に imperative マウントし、React には placeholder `<div>` だけを管理させる構造をとっている。実装は完了済み。

> ただし、Preact 部品を PHP/JS でも React/TS でも使えるようにするだけなら様々な方法がありえる。

そこで、本MEMOでは今後の改良を目指す方向けに、**(a)** 現行は妥当解か、**(b)** 将来どんな状況になったら別案へ移行すべきかを記録する。

関連既存ドキュメント:
- [`docs/implementation/REACT_BRIDGE_PREACT_WRAPPER_V1.md`](../implementation/REACT_BRIDGE_PREACT_WRAPPER_V1.md) — 説明書
- [`docs/specs/ARCHITECTURE_PHASE1_TO_PHASE4.md`](./ARCHITECTURE_PHASE1_TO_PHASE4.md) — Phase 別アーキ方針
- [`docs/specs/FOUNDATION_BOUNDARY_MATRIX.md`](./FOUNDATION_BOUNDARY_MATRIX.md) — 共通基盤の境界
- [`src/react/PreactWrapperV1/README.md`](../../src/react/PreactWrapperV1/README.md) — API リファレンス

---

## 1. preact/compat とは何か

`preact/compat` は本来「**Preact アプリで React API を喋らせる**」ためのレイヤ。bundler で `react`/`react-dom` を `preact/compat` に alias し、React-only ライブラリ (react-router 等) を Preact 上で動かすのが標準用途。

「preact/compat で簡単になる」という主張は、実装上次の 3 通りに分解できる:

### P1: aimg_viewer 全体を preact/compat 化 (= 実質 Preact 化、React 19 を捨てる)
bundler config で `react -> preact/compat` alias。aimg_viewer のソース上は変わらないが、ランタイムは Preact。`nijiurachan-js` の Preact コンポーネントは React 経由で透過的に呼べる。

**前提コスト**: aimg_viewer が React 19 固有機能 (Concurrent, Server Components, 特定 React-only ライブラリ) を必要としないこと。

### P2: nijiurachan-js が preact/compat を内包し React 用 .tsx を export
`@nijiurachan/js/react/*` で React コンポーネントとして見せかけつつ内部は preact/compat。bundler 設定が下流 aimg_viewer 側に染み出すため、現実的に破綻しやすい (二重 React や hook 共有問題)。

### P3: nijiurachan-js を React で書き、Preact 利用側 (AI_BBS) で preact/compat する
preact/compat の本来用途に近い。だが nijiurachan-js を React で書き直すコストが大きく、AI_BBS 側のバンドラ要件も増える。

---

## 2. PreactWrapperV1 が実際に解決している制約

| ID | 制約 | 該当ファイル |
| --- | --- | --- |
| C1 | **二重描画問題**: React の再レンダで Preact が描いた DOM が消えない | `src/react/PreactWrapperV1/custom-element-region.tsx`, `core/custom-element-mount.ts` |
| C2 | **外部 JS (はっちゃん拡張) による DOM 破壊耐性**: `<canvas id="oejs">` を `remove()` され差し替えられても VDOM が壊れない | `src/pure/upfile.ts` 冒頭, `src/elements/upfile-input-v2.ts` |
| C3 | **formAssociated**: Web 標準仕様 `static formAssociated = true` + `attachInternals().form`。Custom Element でしか成立しない | `src/elements/upfile-input-v2.ts` |
| C4 | **初期値の同期 pull (`LatestEventDetailProvider`)**: マウント直後の UI チラつき防止 | `src/react/PreactWrapperV1/use-event-latest.ts`, `src/elements/upfile-input-v2.ts` |
| C5 | **AI_BBS との API 対称性**: AI_BBS 側は `document.getElementById(...).method()`、aimg_viewer 側は `useHost(fullKey)?.method()` で同じ host method を叩く鏡像構造 | `src/react/PreactWrapperV1/use-host.ts` |
| C6 | **配布側の依存軽量性**: peerDependencies が preact 必須・react optional で、AI_BBS 側に React を持ち込まずに済む | `package.json` |

---

## 3. 選択肢マトリクス

| 案 | C1 二重描画 | C2 DOM破壊 | C3 formAssoc | C4 初期値pull | C5 AI_BBS対称 | C6 軽量依存 | 開発コスト | 依存複雑性 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A: aimg_viewer 全体 preact/compat 化 | ◎ | △ | △ | ◎ | △ | ◎ | △ (aimg_viewer 大改修) | ◎ |
| B: nijiurachan-js を React 書き換え | ◎ | △ | △ | ◎ | × | △ (preact 残せる) | × (AI_BBS 巻き添え) | ○ |
| **C: 現行 PreactWrapperV1** | **◎** | **◎** | **◎** | **◎** | **◎** | **◎** | **○ (wrapper 概念コスト)** | **◎** |
| D: Lit / vanilla Web Components | ◎ | ◎ | ◎ | ○ (手書き) | ○ (どちらでもない) | ○ | × (全面書き直し) | ◎ |
| E: デュアル実装 (Preact版 + React版) | ◎ | △ React側脆い | △ | ◎ | △ | △ | × (メンテ二重化) | ○ |

凡例: ◎ 自然解決 / ○ 解決可 / △ 条件付き / × 破綻 or 巨大コスト

### 案 A の解説 — 他の最有力候補

A (aimg_viewer を preact/compat 化) は 5 制約のうち C2/C3 は依然として課題が残るが、それ以外は自然消滅する。

- **C2 (DOM 破壊耐性)**: aimg_viewer が Preact になっても、はっちゃん拡張がはっちゃん用 canvas を `remove()` する瞬間、Preact VDOM 内に埋まっているとやはり差分検出が狂う。**解消しない**。
- **C3 (formAssociated)**: Component として書く限り `<form>` への自動紐付けは効かない。手動で form data を組み立てる必要がある。**解消しない**。

→ **A を選んでも C2/C3 については結局 Custom Element ラッパが要る**。 **A は「ブリッジが半分減る」のであって「不要になる」のではない**。

#### A が妥当になる前提条件
- aimg_viewer に React 19 必須要件がない (Concurrent / Server Components / 特定 React-only ライブラリを使わない)
- aimg_viewer の bundler を弄れる
- C2/C3 用にやはり Custom Element を切るが、その層が薄くて済む (現行の `useEvent`/`useEventLatest`/`useHost`/`Scope` 抽象の一部は不要になる)

### 案 D (Lit) の位置づけ

Lit は formAssociated と Shadow DOM 隔離が標準で強く、フレームワーク中立。**ただし現行コードを全面書き直す必要があり、Phase 4 までは現実的でない**。Phase 5 以降の選択肢として頭出しだけしておく。

---

## 4. V1設計者のDecision — 現条件下での Pareto 最適

C1〜C6 を技術的に満たせるのは C と D だが、開発・移植コストを含めた現実解としては C のみ。A は C2/C3 を残し、B は C5 を破壊し、D は C1〜C6 自体は満たす一方で全面書き直しを伴う移植コストが過大、E はメンテ二重化が即破綻。

PreactWrapperV1 は「正解」ではなく「**現条件下での Pareto 最適**」と位置づける。批評者の主張は P1 を想定すれば部分的に正しい (依存構造はシンプルになる) が、C2/C3 は preact/compat だけでは消えないため「Custom Element 介在ブリッジを完全に省ける」という結論にはならない。

---

## 5. Reconsider トリガ

下記いずれかが起きたら本 MEMO を再評価する:

| ID | トリガ | 観測指標 | 浮上する案 |
| --- | --- | --- | --- |
| T1 | はっちゃん拡張対応依存が消える / 標準化される | `src/pure/upfile.ts` で oejs/oebtnj/baseform の参照が消える | A / B |
| T2 | AI_BBS が React 化される | AI_BBS リポジトリのフロントエンドスタック移行 | B (nijiurachan-js を React に揃える) |
| T3 | aimg_viewer が React 19 固有機能を必要としないと判明 | aimg_viewer の依存に React-only ライブラリがない、SSR 不使用 | A (preact/compat 化) |
| T4 | Lit / Declarative Shadow DOM が業界標準化、formAssociated を VDOM で扱う React API が出現 | React 公式ロードマップ、ブラウザサポート率 | D / C 不要化 |
| T5 | nijiurachan-js が React Native 等の VDOM を持たない環境にも出すことになった | 新クライアント要件 | D (フレームワーク中立) |

各トリガが起きたら本 MEMO を **Reconsider** ステータスへ書き換える。

---

## 6. Consequences

### Positive
- AI_BBS と aimg_viewer の双方が、それぞれ自然な書き方で同一部品 (upfile-input v1/v2 等) を使える
- はっちゃん拡張の DOM 破壊が起きても React/Preact が落ちない
- formAssociated を活かして JSX で `<form>` 配下に置くだけでフォーム連携が成立

### Negative / Trade-off
- consumer (aimg_viewer 等) は `<CustomElementRegion>`・`<Scope>`・`useHost` 等の独自概念を学ぶコスト
- React VDOM の外側にホストを置くため、React DevTools のコンポーネントツリーには Custom Element の内部が出ない
- SSR では Custom Element 自体が HTML に出ない (`useLayoutEffect` で client mount)
- 破壊変更が必要になったら `PreactWrapperV2/` を新設して並走する運用が必要

### Mitigations
- 学習コストは [`src/react/PreactWrapperV1/README.md`](../../src/react/PreactWrapperV1/README.md) と [`docs/implementation/REACT_BRIDGE_PREACT_WRAPPER_V1.md`](../implementation/REACT_BRIDGE_PREACT_WRAPPER_V1.md) でカバー
- DevTools 不可視性は `data-preact-wrapper-v1-key` 属性で要素を識別できるようにしてある

---

## 付録: クリティカルファイル

- `src/react/PreactWrapperV1/README.md`
- `docs/implementation/REACT_BRIDGE_PREACT_WRAPPER_V1.md`
- `src/pure/upfile.ts` (はっちゃん拡張の挙動説明)
- `src/elements/upfile-input-v2.ts` (formAssociated 実例)
- `src/components/upfile-input-fragment-v2.tsx` (canvas oejs 取り扱い)
- `package.json` (peerDependencies の構造)
- `docs/specs/ARCHITECTURE_PHASE1_TO_PHASE4.md`
- `docs/specs/FOUNDATION_BOUNDARY_MATRIX.md`
