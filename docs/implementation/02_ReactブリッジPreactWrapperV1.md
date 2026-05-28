# React ↔ Preact Custom Element 橋渡し: PreactWrapperV1 説明書

`nijiurachan-js` が AI_BBS と aimg_viewer の双方に共有部品を供給するための
**React 側橋渡しブリッジ** `PreactWrapperV1` の説明書。

> 各 API のシグネチャ・型・遅延リスナの内部仕様などの**正本**は
> [`src/react/PreactWrapperV1/README.md`](../../src/react/PreactWrapperV1/README.md) を参照する。
> 本文書はそれらを束ねる入口・概念整理。
>
> 「なぜ preact/compat ではなくこのアプローチを選んだのか」「将来どんな状況になったら別案を検討すべきか」の
> **設計判断の根拠**は [`docs/specs/MEMO_REACT_BRIDGE_DECISION.md`](../specs/MEMO_REACT_BRIDGE_DECISION.md) を参照する。

## 1. なぜラッパーが必要か

`nijiurachan-js` の共有部品は **Preact + Custom Element** で書かれている:

- [`src/elements/upfile-input.ts`](../../src/elements/upfile-input.ts) — 添付ファイル欄
- [`src/elements/upfile-input-v2.ts`](../../src/elements/upfile-input-v2.ts) — 同 headless 版 (UI ボタンを描画しない)
- [`src/elements/wheel-reload-handler.ts`](../../src/elements/wheel-reload-handler.ts) — ホイール末尾でリロード要求
- [`src/elements/axnos-paint-host.ts`](../../src/elements/axnos-paint-host.ts) — アクノスペイント受け窓口
- ほか `lazy-turnstile.ts` / `online-users-indicator.ts` / `bouyomi-connector.ts` 等

これらは AI_BBS (PHP + 部分 TS) と aimg_viewer (React + TS) の **両方** から使われる。
本ラッパが満たしたい要件は、突き詰めると次の 2 つ:

1. **両環境で使える共有部品の窓口を提供する** (PHP からも React からも同じ要素を呼べる)
2. **外部 JS に DOM を破壊されても落ちない空間を提供する** (はっちゃん拡張対策)

要件を素朴に読むと「Custom Element を作って、React からは `createElement` で挿すだけ」
で済みそうに見える。実際 [`core/custom-element-mount.ts`](../../src/react/PreactWrapperV1/core/custom-element-mount.ts) の本体は 30 行ほどしかない。

しかし、 **React 側がその「箱」と通信しようとした瞬間、React 固有の事情が 4 つ降ってくる** ために
`registry.ts` / `useEvent` / `useEventLatest` / `Scope` といった層を介する必要が生じる。

### 前提: React の「VDOM」と「コミット順」

- React は JSX を直接 DOM にせず、まず **VDOM (仮想 DOM ツリー)** を組み、差分を計算してから DOM を書き換える
- React が管理している DOM ノードを外部 JS が勝手に消すと、次の差分計算で React が壊れる
- React コンポーネントは「描画 (render)」と「画面反映 (commit)」が分離されており、
  **どの順番で commit されるかは保証されない**。兄弟コンポーネントの `useEffect` が
  自分の `useEffect` より先に走ることもある
- React 18 以降の StrictMode では、開発中だけ「mount → unmount → 再 mount」が**故意に 2 回実行**される
  (副作用の取りこぼしを検出するため)

これらを踏まえると、要件 1 と 2 を満たそうとした瞬間に次の 4 つの構造的課題が現れる。

### 理由 1: VDOM の "外" と React state の双方向通信が必要になる

要件 2 を満たすため、Custom Element は **React VDOM の外側**に置く (後述の図) 。
こうすれば外部 JS が中身を破壊しても React は無関係。だがこの瞬間、React 標準の
**props/children によるデータ受け渡しが一切使えなくなる** (React は箱の中を知らないため)。

代わりに必要になるのが:

- 下り方向 (React → 箱): 属性同期、要素 method 呼び出し
- 上り方向 (箱 → React): CustomEvent の購読、最新値の同期取得

AI_BBS 側は素朴に `document.getElementById(...).method()` や `addEventListener` で書ける。
React 側で同じことを「VDOM のライフサイクル規律を守りつつ」やるための翻訳層が
`useHost` / `useEvent` / `useEventLatest` である。**AI_BBS 側に対称物がない非対称な複雑さは、React 側の都合**から来ている。

### 理由 2: マウント順が不定なので "間接ハンドル" が要る

たとえば次のような JSX を考える:

```tsx
<>
  <PaintToast />                                      {/* A: useEvent("main", "aimg:painted", ...) */}
  <CustomElementRegion id="main" tag="upfile-input"/> {/* B: 実際に host を生む */}
</>
```

A の `useEvent` と B の Region マウントは別のコンポーネントなので、
React のスケジューラの都合で **A の `useEffect` が先に走り、host がまだ存在しない瞬間がある** 。

普通に書くと「listener を張ろうとしたら host が `null`」で詰む。これを回避するため、
[`core/registry.ts`](../../src/react/PreactWrapperV1/core/registry.ts) で **fullKey をキーにした間接ハンドル**を先に作っておき、

- 購読側 (`useEvent`) は「ハンドル」に対してリスナを予約する
- マウント側 (Region) は host を生成したら「ハンドル」に host を後付けする
- 後付けされた瞬間、予約されていたリスナをまとめて host に張る

という **遅延結合パターン**を採用している。これは「pub/sub のブローカ」と同じ発想で、
購読要求と提供者の出現順を切り離すための古典的な設計だが、React の commit 順非決定性が
ある限り**省略できない**。

### 理由 3: "破壊耐性" を実用レベルにすると "再 attach 整合" まで必要になる

要件 2 を「壊れた瞬間に落ちなければ良い」程度で止めれば、
`host.parentNode === placeholder` チェックを入れるだけで済む。

しかし実運用では **破壊された後に React が再レンダして Region が再マウント**される。
このとき何も考えずに新 host を attach すると:

- 古い host にぶら下がっていたリスナが残ったままで、メモリリーク + 古い DOM 由来の二重 dispatch
- 古い host から受け取った最新値 (`latestEventDetails`) が新 host の状態と矛盾する
- `useEventLatest` の購読者が古い値で固まって React の再レンダが発火しない

`registry.ts:53` の `attachHost` が `host && handle.host !== host` をチェックして
旧 listener を剥がし、`latestEventDetails` をクリアし、購読者を全件再通知しているのは、
**「破壊された後にまた立ち上がる」という再 attach 経路の整合性を全部成立させているため**である。

これは StrictMode の二重 mount でも同じ経路を通るので、本番だけでなく**開発時の正しさ**にも必要。

### 理由 4: 初回チラつき防止のため push/pull 二経路が要る

React のレンダは「初回 render → commit → useEffect (副作用) → 必要なら再 render」の順。
Custom Element 側が「mount された → CustomEvent を dispatch する」順だと、
**React の初回 render は値を受け取る前に走るため、画面が一瞬 `undefined` で描かれてチラつく**。

これを潰すために `useEventLatest` は 2 経路を持つ:

- **push 経路**: dispatch された CustomEvent.detail をキャッシュする (通常経路)
- **pull 経路**: host が `getLatestEventDetail(name)` を実装していれば、
  dispatch がまだの間だけそれを同期で読みに行く

`upfile-input-v2` は `connectedCallback` の中で render より前に
`#latestUiHint` / `#latestStateFlags` に初期値を入れておくので、
React 初回 render から正しい値が読めてチラつかない。
これも「VDOM の外の状態を、React の同期 read 規約に合わせて見せる」ための追加レイヤである。

### まとめ: 複雑さの出所

| 層 | 由来する制約 | 該当ファイル |
| --- | --- | --- |
| 翻訳層 (Hooks) | 理由 1: VDOM 外と通信する手段が React 標準にない | `use-event.ts` / `use-event-latest.ts` / `use-host.ts` |
| registry 間接化 | 理由 2: React のコミット順が不定 | `core/registry.ts` の `getOrCreateHandle` |
| 再 attach 整合 | 理由 3: 外部 JS 破壊 + StrictMode 二重 mount | `core/registry.ts` の `attachHost` / `detachHost` |
| pull 経路 | 理由 4: 初回 render のチラつき防止 | `LatestEventDetailProvider` 契約 |
| Scope/fullKey | 同一タグの複数インスタンス識別 | `scope.tsx` / `core/full-key.ts` |

要件 1・2 そのものは単純だが、**それを React 側で「自然に」「安全に」「正しく」使えるようにする**ためには、
React 由来の 4 つの構造的事情を埋める必要があり、それが `PreactWrapperV1` の各層に対応している。

### Preact 側の DOM を React に守らせる方針

「React VDOM の中身に Custom Element を生やす」のではなく、
**React は placeholder の `<div>` だけを管理し、Custom Element はその下に imperative に挿入する**
という構造を採る (= 上記理由 1 の前提) 。

```
+----------------- React VDOM ----------------+
|  <div data-preact-wrapper-v1-key=...>       |   ← React 管理
|    <upfile-input-v2 data-allow-type=...>    |   ← React 管理外 (createElement+appendChild)
|      <input type=file>                      |
|      <figure id=ftbl> ... </figure>         |   ← Preact 管理
|      <canvas id=oejs>                       |   ← はっちゃん拡張に乗っ取られる可能性
|    </upfile-input-v2>                       |
|  </div>                                     |
+---------------------------------------------+
```

この構造により、

- 内部 DOM が外部 JS に破壊されても React は影響を受けない (要件 2)
- Preact 側の hooks がそのまま動く
- formAssociated は JSX の `<form>` 配下に置くだけで成立

## 2. 何を持ち込んだか (構成)

```
src/react/PreactWrapperV1/
├── README.md                           # API 正本 (詳細リファレンス)
├── preact-wrapper-v1.ts                # 名前空間オブジェクト
├── types.ts                            # ScopeProps / CustomElementRegionProps / LatestEventDetailProvider
├── scope.tsx                           # <Scope name=...>
├── custom-element-region.tsx           # <CustomElementRegion tag=... id=...>
├── use-event.ts                        # useEvent(fullKey, name, cb)
├── use-event-latest.ts                 # useEventLatest(fullKey, name, selector?)
├── use-host.ts                         # useHost(fullKey)  ← imperative escape hatch
└── core/
   ├── registry.ts                     # fullKey → InstanceHandle のシングルトンレジストリ
   ├── custom-element-mount.ts         # placeholder への createElement+appendChild
   ├── full-key.ts                     # buildFullKey(scopeName, id)
   ├── scope-context.ts                # ScopeContext
   └── types.ts                        # InstanceHandle 型
```

### 役割分担

| レイヤ | 中身 |
| --- | --- |
| `core/` | レジストリ・マウント |
| トップレベル | `<Scope>` / `<CustomElementRegion>` / `useEvent` / `useEventLatest` / `useHost` |

`PreactWrapperV1/` 直下は要素のイベント名・属性・method 名を一切ハードコードしない。

### 公開モジュール (consumer 側 import 形)

- `@nijiurachan/js/react/PreactWrapperV1` — 汎用ブリッジ

`package.json` の `exports` で公開済 ([`package.json`](../../package.json#L46-L53))。

## 3. 利用側の最小手順

### 3.1 起動時 (1 度だけ)

要素クラスを組み立て、レジストリに登録する。

```ts
// 汎用パスで登録する場合
import { makeUpfileInputElement } from "@nijiurachan/js/elements/upfile-input"
import { makeUpfileInputFragment } from "@nijiurachan/js/components/upfile-input-fragment"

const UpfileInputClass = makeUpfileInputElement(
    makeUpfileInputFragment(myAxnosPaintPopup),
)
UpfileInputClass.define()
```

### 3.2 マウント

```tsx
<PreactWrapperV1.Scope name="post-form">
    <form>
        <PreactWrapperV1.CustomElementRegion
            id="upfile"
            tag="upfile-input-v2"
            attributes={{ "data-allow-type": "file,draw" }}
        />
    </form>
</PreactWrapperV1.Scope>
```

`fullKey` は `"post-form:upfile"`。`<Scope>` を省略すると `"upfile"` がそのまま fullKey になる。

### 3.3 購読

| やりたいこと | 使う API |
| --- | --- |
| 単発の CustomEvent に副作用を流したい | `useEvent(fullKey, name, cb)` |
| 直近 detail を React state として読みたい | `useEventLatest(fullKey, name, selector?)` |
| ローカルツリーで `preventDefault` 等したい | `<CustomElementRegion localHandlers={...}>` |
| host 要素の method を呼びたい (escape hatch) | `useHost(fullKey)` |

詳細仕様は [`PreactWrapperV1/README.md`](../../src/react/PreactWrapperV1/README.md#api)。

### 初期値 pull の仕組み (`LatestEventDetailProvider`)

`useEventLatest` の本来の挙動は「初回 dispatch までは `undefined`」なので、
**Region マウント直後の 1 フレームだけ UI がチラつく** 問題があった。

これを解消するために、host 要素が次の shape を実装すると `useEventLatest` が
**マウント後すぐ同期で初期値を pull** する経路を追加した:

```ts
interface LatestEventDetailProvider {
    getLatestEventDetail(eventName: string): unknown | undefined
}
```

`upfile-input-v2` は `connectedCallback` 内で render より前に
`#latestUiHint` / `#latestStateFlags` を mode=empty の値で種まきしてあるので、
`useUpfileV2UiHint` / `useUpfileV2State` は mount 後の最初の render から正しい値を返す
([`upfile-input-v2.ts:45-58`](../../src/elements/upfile-input-v2.ts))。

新しく同様のパターンでカスタムエレメントを作るときは、host 要素がこの shape を満たすかどうかを把握しておくこと
(満たしていなくても動くが、初回 undefined ガードが consumer 側に必要になる)。

## 4. 詳細仕様への入口

| 知りたいこと | 参照先 |
| --- | --- |
| 各 API のシグネチャ / 戻り値型 / 遅延リスナの内部 | [`src/react/PreactWrapperV1/README.md`](../../src/react/PreactWrapperV1/README.md) |
| upfile-input v1 / v2 の違い | [`src/elements/upfile-input.ts`](../../src/elements/upfile-input.ts) と [`src/elements/upfile-input-v2.ts`](../../src/elements/upfile-input-v2.ts) を読み比べる |
| 共通基盤のどこに何を置くか (境界整理) | [`docs/specs/FOUNDATION_BOUNDARY_MATRIX.md`](../specs/FOUNDATION_BOUNDARY_MATRIX.md) |
| イベント契約 (`aimg:*`) | [`src/components/types.ts`](../../src/components/types.ts) |
| upfile の状態遷移ロジック | [`src/pure/upfile.ts`](../../src/pure/upfile.ts) |
| `bun link` で symlink 利用するときの注意 | [`src/react/PreactWrapperV1/README.md` §インストール](../../src/react/PreactWrapperV1/README.md) |

## 5. 制限事項 / 未着手 (V1)

- `<Scope>` のネスト未対応 (検出時は開発時例外)
- `localHandlers` のキー集合は Region マウント時にスナップショット (render 中の動的増減追随なし)
- SSR HTML 中に Custom Element 自体は出ない (`useLayoutEffect` がクライアント初回描画で走る形)
- pull 系の API (`getFile()` 等) はまだ。今は CustomEvent push + host method の 2 経路のみ
- 破壊変更が必要になったら `PreactWrapperV2/` を新設する方針 (V1 はそのまま残す)
