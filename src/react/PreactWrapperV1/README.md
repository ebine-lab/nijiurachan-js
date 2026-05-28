# PreactWrapperV1

React/TS クライアントから、`nijiurachan-js` の Custom Element (Preact 内部描画) を安全に使うための**汎用ブリッジ**。

本バージョンは「要素非依存の generic API」に限定する。特定要素 (upfile-input 等) 向けの型付き sugar は各アプリでこのブリッジを利用して定義する。

> 全体像 (背景・利用法) は
> [`docs/implementation/02_ReactブリッジPreactWrapperV1.md`](../../../docs/implementation/02_ReactブリッジPreactWrapperV1.md) を参照。
> 本ファイルは API 詳細リファレンスの正本として残す。

## 責務

1. **Preact パーツを扱うための箱** — Custom Element を React VDOM の外側に imperative マウント
2. **ハンドラ外部購読の窓口** — ツリー外から CustomEvent を副作用型で購読 (`useEvent`)
3. **フラグ/直近 detail の受け渡し窓口** — 直近 CustomEvent.detail を値として購読 (`useEventLatest`)
4. **React に管理されない Custom Element を置くための窓口** — 内部 DOM が外部 JS に破壊されても React が落ちない堅牢性
5. **名前空間の窓口** — `<Scope>` と `buildFullKey` で要素インスタンスの識別子を分離
6. **imperative な host 操作の escape hatch** — `useHost` で host 要素参照を取得し、`dispatchEvent` や要素 method を React 側から呼べる

## インストールと初期化

1. **依存の追加**
   `react` を `^19.0.0` で導入（peerDependency 宣言と同一範囲）。React 20 以降は未検証。`nijiurachan-js` は `optional peerDependency` として `react` を宣言している。

2. **Custom Element クラスの DI**
   `nijiurachan-js` の要素はアプリ側でファクトリを組み立てる必要があるため、
   アプリ起動時に一度だけクラスを登録する:

   ```ts
   import { PreactWrapperV1 } from "@nijiurachan/js/react/PreactWrapperV1"
   import { makeUpfileInputElement } from "@nijiurachan/js/elements/upfile-input"
   import { makeUpfileInputFragment } from "@nijiurachan/js/components/upfile-input-fragment"
   import { myAxnosPaintPopup } from "./axnos"

   const UpfileInputClass = makeUpfileInputElement(
       makeUpfileInputFragment(myAxnosPaintPopup),
   )
   UpfileInputClass.define()
   ```

   - `UpfileInputClass.define` が `customElements.define` を呼ぶ
   - 未登録のまま `<CustomElementRegion tag="...">` をマウントしようとすると開発時エラー

### `bun link` で symlink 利用する場合

`bun link` で consumer アプリに本パッケージを symlink する場合、**consumer 側の tsc が
本パッケージの `.ts` / `.tsx` を自プロジェクトの一部として型チェックします** (型の実体は
コンパイル済 `.d.ts` ではなくソースに解決されるため)。

使う前に必ず本リポジトリ側で `bun install` を実行して `node_modules/` を用意してください。
preact / react / @types/react 等の本パッケージ側の依存が揃っていないと、consumer の
tsc が本パッケージのソース内で解決に失敗します。

また、本パッケージの `.tsx` は Preact JSX を使うファイルに file-level pragma
`/** @jsxImportSource preact */` を付けて consumer 側の `jsxImportSource: "react"` を
ファイル単位で上書きしています。consumer 側の tsconfig は変更不要です。

## API

```ts
import { PreactWrapperV1 } from "@nijiurachan/js/react/PreactWrapperV1"
```

| 名前 | 種類 | 役割 |
| --- | --- | --- |
| `Scope` | Component | 配下 Region の `fullKey` を `"<name>:id"` にする名前空間 |
| `CustomElementRegion` | Component | 任意 Custom Element を React 外側にマウントする「箱」 |
| `useEvent(fullKey, eventName, cb)` | Hook | CustomEvent を副作用型で購読 |
| `useEventLatest(fullKey, eventName, selector?)` | Hook | 直近 CustomEvent.detail を値として取得 (任意 selector で絞り込み)。host 側が `LatestEventDetailProvider` を実装していれば初回 dispatch 前でも初期値 pull 可 |
| `useHost(fullKey)` | Hook | host 要素参照を取得 (imperative 操作用 escape hatch) |
| `buildFullKey(scopeName, id)` | Function | `fullKey` の組み立てユーティリティ |

### `<Scope name="...">`

```tsx
<form>
  <PreactWrapperV1.Scope name="post-form">
    <PreactWrapperV1.CustomElementRegion
      tag="upfile-input"
      id="main"
      attributes={{ "data-allow-type": "file" }}
    />
  </PreactWrapperV1.Scope>
</form>
```

- 配下の `<CustomElementRegion id="main">` の `fullKey` は `"post-form:main"` になる
- Scope なしの場合は `fullKey` = `id` そのまま
- **ネスト禁止**: 親 Scope が既にある状態でもう一度 `<Scope>` を置くと例外
- `name` は空文字不可

### `<CustomElementRegion>`

```tsx
<PreactWrapperV1.CustomElementRegion
  tag="upfile-input"
  id="main"
  attributes={{ "data-allow-type": "file" }}
  localHandlers={{
    "aimg:reloading": (e) => {
      if (isSubmitting) e.preventDefault()
    },
    "aimg:painted": (e) => savePainted(e.detail),
  }}
/>
```

| prop | 型 | 役割 |
| --- | --- | --- |
| `tag` | `string` | 必須。内部に生成する Custom Element のタグ名 |
| `id` | `string` | 必須。`Scope` と合成して fullKey 化 |
| `attributes` | `Record<string, string \| undefined>` | `connectedCallback` が要求する属性はここで渡す。appendChild 前に `setAttribute` される |
| `localHandlers` | `LocalHandlers` | Region 内でローカルに購読したい CustomEvent。`GlobalEventHandlersEventMap` 拡張で detail 型が narrow される |
| `className` | `string` | placeholder の `<div>` に反映 |
| `style` | `CSSProperties` | 同上 |

**描画構造**:

```html
<div class="..." data-preact-wrapper-v1-key="post-form:main">
  <upfile-input data-allow-type="file">
    <!-- Preact がここを描画する。React は一切触らない -->
  </upfile-input>
</div>
```

- React は placeholder `<div>` だけを管理し、内部要素には干渉しない
- はっちゃん/axnospaint 等の外部 JS が内部を `remove()` / `innerHTML = ""` しても React のアンマウントは安全
- formAssociated は JSX で `<form>` 配下に置くだけで成立

### `useEvent(fullKey, eventName, callback)`

```tsx
function PaintToast() {
  PreactWrapperV1.useEvent("post-form:main", "aimg:painted", (e) => {
    toast.success("画像を保存しました")
  })
  return null
}
```

- `callback` は毎レンダで差し替えてOK (ref で保持、リスナ張替えは起きない)
- `eventName` は `GlobalEventHandlersEventMap` で型が絞られる (要素側で `declare global` 拡張している範囲で detail まで narrow)
- Region がマウントされる前にフックを呼んでも安全 (ハンドルは遅延生成)

### `useEventLatest(fullKey, eventName, selector?)`

```tsx
// selectorなし: detail をそのまま受け取る
function LastPaint() {
  const detail = PreactWrapperV1.useEventLatest(
    "post-form:main",
    "aimg:painted",
  )
  return detail ? <img src={URL.createObjectURL(detail.image!)} /> : null
}

// selectorあり: フラグや一部分だけ取り出す。前回と同値なら consumer は再レンダされない
function SubmitButton() {
  const isBusy = PreactWrapperV1.useEventLatest(
    "post-form:main",
    "aimg:upfile-state",
    (d) => d.isBusy,
  )
  return <button disabled={isBusy}>送信</button>
}
```

- `selector` 省略時は detail そのものを返す
- `selector` あり時は戻り値をキャッシュし、前回と同一参照なら consumer は再レンダされない (`useSyncExternalStore`)
- 初回 dispatch 前でも、host が `LatestEventDetailProvider` (後述) を実装していれば初期値を同期 pull できる (attach 済みの場合に限る)。未実装・未 attach なら `undefined`
- 非 `CustomEvent` のイベント (`detail` を持たない) は型レベルで `never` 推論されて弾かれる

> **selector は純粋・primitive 指向で書くこと**。pull→push 初回切替時、値は同 shape でも**オブジェクト参照が1度変わる**。selector 内に副作用 (analytics / 送信) を入れたり、detail オブジェクトをそのまま `useEffect` の依存に積むと余分に 1 回副作用が走る。primitive を取り出してから下流に流すのが安全。

#### `LatestEventDetailProvider` コントラクト

```ts
export interface LatestEventDetailProvider {
  getLatestEventDetail(eventName: string): unknown | undefined
}
```

Custom Element (host) がこの shape を持つと、`useEventLatest`は**まだ dispatch されていないイベントに対しても**初期値を同期で取得する:

1. push 経路: `host.dispatchEvent(new CustomEvent(name, { detail }))` が走ると registry の`latestEventDetails[name]`が埋まる。以後はこちらが優先。
2. pull 経路: push 経路が空の間のみ、`host.getLatestEventDetail(name)`を同期で呼ぶ。戻り値が`undefined`なら「まだ無い」扱い。

利用側の典型的な実装:

```ts
class MyElement extends HTMLElement implements LatestEventDetailProvider {
  #latestHint: MyHintFlags | null = null

  connectedCallback() {
    // ①renderより前に初期値を種まき
    this.#latestHint = computeInitialHint(this.dataset)
    render(h(Frag, { onHintChange: (h) => {
      this.#latestHint = h                           // ②以降も最新に保つ
      this.dispatchEvent(new CustomEvent("my:hint", { detail: h, bubbles: true }))
    } }), this)
  }

  disconnectedCallback() { this.#latestHint = null } // ③detach後は再びundefined

  getLatestEventDetail(name: string): unknown | undefined {
    return name === "my:hint" ? (this.#latestHint ?? undefined) : undefined
  }
}
```

実装は任意。無ければ従来通り「初回 dispatch まで`undefined`」。

### `useHost(fullKey)`

```tsx
function InjectPastedImage({ pastedFile }: { pastedFile: File | null }) {
  const host = PreactWrapperV1.useHost("post-form:main")
  useEffect(() => {
    if (!host || !pastedFile) return
    // 要素側に生やした imperative method を呼ぶ
    ;(host as UpfileV2Element).injectFile(pastedFile)
  }, [host, pastedFile])
  return null
}

function SubmitButton() {
  const host = PreactWrapperV1.useHost("post-form:main")
  const onSubmit = () => {
    const file = (host as UpfileV2Element | null)?.getFile()
    // ...
  }
  return <button onClick={onSubmit}>送信</button>
}
```

- Region 未マウント時は `null`、`attachHost` 後に host 参照、`detachHost` で再び `null`
- 同じ host がアタッチされ続ける限り参照は安定 (consumer は再レンダされない)
- **用途は escape hatch**: event 受信は `useEvent` / `useEventLatest`、属性渡しは `attributes` prop を使うこと。`useHost` は「CustomEvent に詰めにくい File / 非シリアライザブル値の push」「要素 method 呼び出し」が必要なときに使う
- AI_BBS (素の Web Components 利用) 側と API が対称になる: あちらは `document.getElementById(...).injectFile(file)`、React 側は `useHost(key)` 経由で同じ method を叩く

### `buildFullKey(scopeName, id)`

- `<Scope>` 外の兄弟ツリーから購読する際、`fullKey` を組み立てるユーティリティ
- `scopeName === undefined` なら `id` をそのまま返す

## 遅延リスナ

- host に `addEventListener` を張るタイミングは、「どの購読者 (`useEvent` / `useEventLatest` / Region の `localHandlers`) が要求したか」で決まる
- 購読者ゼロになったら `removeEventListener` する
- Region がマウントされる前にフックが `useEvent` した場合、registry はリスナオブジェクトを保留し、`attachHost` 時にまとめて付ける

この設計により generic body はイベント名の一覧を一切ハードコードしない。

## 堅牢性

### 内部 DOM が外部 JS に破壊されても落ちない

- React は `<upfile-input>` の**外側**の `<div>` しか管理しない
- Custom Element と内部の Preact 描画領域は `document.createElement` + `appendChild` で React VDOM の外側に生成
- アンマウントは `placeholder.contains(host) && placeholder.removeChild(host)` のガード付きなので、ホストが既に外部 JS に消されていても例外にならない

### やらないこと (利用側の責務)

- placeholder の `<div>` 自体が外部 JS に消された場合: React が警告を出す可能性あり。ラッパ外側の構造に手を入れる外部 JS は想定外
- 属性を外部 JS が書き換えた場合: 次の `useEffect` の diff 反映で上書きされる

## 制限事項 (v1)

- `Scope` のネスト未対応
- `localHandlers` のキー集合は Region マウント時にスナップショット (render 間で増減しても追随しない)
- SSR 時は `defineOnce` と `useLayoutEffect` がクライアント初回描画で走る。SSR HTML 中に Custom Element 自体は出ない

## 破壊変更を入れたくなったら

`src/react/PreactWrapperV2/` を新設して独自の `core/` を持つ。V1 はそのまま残す。外部からは `@nijiurachan/js/react/PreactWrapperV1` / `...V2` と選択可能。

## 関連

- `src/elements/*` — ラップ対象の Custom Element 群
- `src/components/types.ts` — `aimg:*` CustomEvent 契約 (`GlobalEventHandlersEventMap` 拡張)
- `src/pure/upfile.ts` — upfile 関連の純粋ロジック (state flags 等)
- [`docs/specs/03_Reactブリッジ設計メモ.md`](../../../docs/specs/03_Reactブリッジ設計メモ.md) — PreactWrapperV1 設計時、ラッパーという形式を選んだことについての考察
