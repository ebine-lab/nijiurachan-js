/**
@file 添付ファイル/お絵描き状態の交通整理

# upfile.tsについて

下記のような感じで、添付ファイルとお絵描きデータの兼ね合いが若干ややこしい。
このモジュールはそういう判定をまとめる。

## 画像添付まわりの事情

あいもげは本家同様、普通の画像ファイルをアップして添付する他にお絵描きができる。

本家掲示板では、アップ画像は下の形で扱っている。

- 添付画像: `<input type="file" name="upfile">`
- 手書きデータ: `<input type="hidden" id="baseform" name="baseform">` (内容はpng画像をBase64にした物)

本家はupfileとbaseformを両方送り、両方内容がある場合はupfileが優先という動作だが、
あいもげではupfileしかなく、最後に使ったほうが勝つ動作をする。
これはあいもげのほうが親切だと思…いやあんまり変わんないかな…

細かいことを言うとあいもげはpasteイベントで画像の貼り付けにも対応しているが、
扱いとしてはupfileに画像を指定するのと同じなので割愛する。

## お絵描きツールについて

あいもげは、次の2種類のツールに対応する。

- アクノスペイント
- はっちゃんキャンバス

前者はOSSをあいもげに組み込んでいるが、後者はサードパーティのブラウザ拡張(非OSS)。
アクノスペイントよりはっちゃんのほうが高機能でユーザ人気も高いので、サポートしない選択肢は無い。
なのではっちゃんが問題なく動作するようあいもげ側から気を使ってあげる必要がある。

### アクノスペイントの扱い

こちらは単純。

- ポップアップで表示してユーザにお絵描きしてもらう
- お絵描き完了ボタンを押すと、画像のblobがメッセージで飛んでポップアップが閉じる
- blobをURLにしてupfileに設定すればOK

本来画像はpngファイルをBase64文字列にした物が飛んでくるが、ちょっと裏技を使って
blobで送ってもらうようにしてある。(webpがほしいので。`axnos-paint-host.ts`参照)

### はっちゃんキャンバスの扱い

#### 基本姿勢

- 本家のHTML構造とJS挙動がそのままプロトコルである。
- 更新時壊れやすくなるので、はっちゃん内部のHTML構造などは決め打ちしない。

#### はっちゃんの入出力

はっちゃんはキャンバスに絵を出力するので、動作には最低限これが必要。

- `<canvas id="oejs">`

他の要素は無くても動くが、下の要素にも反応するのが便利なので活用する。

- `<div id="oebtnj">`
- `<table id="ftbl">`
- `<input type="hidden" id="baseform">`

はっちゃんはoejsが見つからないとき、下の動作をする。

- oebtnjを押す
- ftblの中にoejsが置かれるのをMutationObserverで待ち受ける

この"oebtnjを押す"という動作は数少ないはっちゃんの発するシグナルなので、処理のきっかけとして活用する。

出力形式としては、はっちゃんは静的画像またはアニメ画像を作る。
素のはっちゃんはキャンバスに描くだけだが、レイヤー拡張とタイムラプス拡張を有効にするとapngを生成するようになる。

- はっちゃんが静的画像を出力するときは、oejsに描き込み、baseformは触らない様子
- はっちゃんがアニメ画像を出力するときは、baseformにapngファイルをBase64にしたものを設定する様子
    - oejsは削除(！)されてプレビュー用のimgタグに差し替えられる

(！) はっちゃんがoejsを消すのはおそらく、本家掲示板ではoejsを置いたままだと本家の処理が働いてbaseformが静的画像で上書きされてしまうため

#### はっちゃん利用の流れ

はっちゃんはアクノスペイントと違い、お絵描き完了というイベントは特に無い。
なので、キャンバスを画像データに固めるタイミングは投稿ボタンを押した瞬間しかない。
(終了する×ボタンはあるが、お絵描き自体は継続しており再開可)

- あいもげ側はoebtnjとftblを非表示で置いておき、はっちゃんが押すのを待つ
- はっちゃんにoebtnjが押されたら、ftbl下にoejsとbaseformを配置して非表示を解除する
- 投稿処理で、oejsとbaseformのどちらかをupfileに取り込む([後述](#投稿))

## 添付ボタンとお絵描きの兼ね合い

### 細かい制御

"添付済ですが上書きしますか？"のようなメッセージを出したくないので、次のようにモードを設けて
アクノスペイントとはっちゃんを排他する。
お絵描きツールを切り替えたいときはユーザに都度クリアボタンを押してリセットしてもらう形。

- 初期モード
    - upfile・お絵描きボタン・貼付ボタン・クリアボタンを表示
    - oebtnjを非表示で生成しはっちゃんを待ち受ける
    - oejsとbaseformがもしあったら除去
    - プレビューは空
    - upfileでファイルが選択された時、ファイル添付モードに入る
    - お絵描きボタンが押されたらアクノスペイントを起動し、アクノス待ちモードに入る
    - oebtnjが押されたらはっちゃん起動とみなし、はっちゃん待ちモードに入る
    - 貼付ボタンが押されたらクリップボードを試し、ファイル添付モードに入る(権限で失敗したら初期モードのまま)
        - Ctrl+Vやドラッグ＆ドロップも同様

- ファイル添付モード
    - upfile・貼付ボタン・クリアボタンを表示、お絵描きボタンは非表示
    - oebtnjとoejsとbaseformがあったらどれも除去
    - プレビューはupfileの内容を表示
    - 貼付ボタンが押されたらクリップボードを試し、画像を差し替え
    - Ctrl+Vやドラッグ＆ドロップも同様
    - はっちゃんは受け付けない

- アクノス待ちモード
    - クリアボタンのみ表示、upfile・貼付ボタン・お絵描きボタンは非表示
    - oebtnjとoejsとbaseformがあったらどれも除去
    - プレビューは空
    - アクノスがお絵描き完了したらupfileに反映しファイル添付モードに入る
        - はっちゃん待ちモードに入ることもできなくはないが、ややこしいので要望が出てから考える
    - 制御が大変なのではっちゃん・Ctrl+V・ドラッグ＆ドロップは受け付けない

- はっちゃん待ちモード
    - クリアボタンのみ表示、upfile・貼付ボタン・お絵描きボタンは非表示
    - oejsとbaseformを生成する
    - プレビューは空 (はっちゃんが自前で表示してくれるはず)
    - 制御が大変なのでアクノスペイント・Ctrl+V・ドラッグ＆ドロップは受け付けない

- 全モード共通
    - クリアボタンが押されたら、upfileをクリアして初期モードに戻る
    - どのモードでも投稿ボタンは押すことができる
        - 細かい送信処理はこのモジュールでは扱わないので、クリアボタンと効果は同じ

### 投稿処理の手順

投稿自体はどのモードであってもこの処理でOKなはず。

- oejsがあったら、その内容をupfileに取り込む
- baseformがあったら、その内容をupfileに取り込む
- upfileの内容を画像データとしてアップする
*/

/** 添付ファイルの受付状況 */
export type UpfileMode =
  | "empty"
  | "file-attached"
  | "waiting-axnos"
  | "waiting-klecks"
  | "waiting-hacchan"

/**
 * 添付File欄の状態フラグ。
 * 外部ツリー (React ラッパ経由の別コンポーネント等) が購読して、
 * 送信ボタンの disabled 判定などに使う想定の派生状態。
 */
export interface UpfileStateFlags {
  /** ファイルが添付されている (プレビュー表示中) */
  hasSelectedFile: boolean
  /** アクノスペイントのポップアップ待機中 */
  isAxnosOpen: boolean
  /** Klecksのポップアップ待機中 */
  isKlecksOpen: boolean
  /** はっちゃんキャンバス待機中 */
  isHacchanOpen: boolean
  /** 何らかの作業中でリロード等を止めたい */
  isBusy: boolean
  /** 投稿フォームが折り畳まれている */
  isPopupFormCollapsed: boolean
}

/** toUpfileStateFlags の外部入力 (mode 単独では決まらないもの) */
export interface UpfileStateExtras {
  /** 投稿フォームが折り畳まれているかどうか */
  isPopupFormCollapsed: boolean
}

/**
 * 現在のモードと外部情報から状態フラグを導出する。
 * 外部購読用に意味を一箇所に集約するための純粋関数。
 */
export function toUpfileStateFlags(
  mode: UpfileMode,
  extras: UpfileStateExtras,
): UpfileStateFlags {
  const hasSelectedFile = mode === "file-attached"
  const isAxnosOpen = mode === "waiting-axnos"
  const isKlecksOpen = mode === "waiting-klecks"
  const isHacchanOpen = mode === "waiting-hacchan"
  return {
    hasSelectedFile,
    isAxnosOpen,
    isKlecksOpen,
    isHacchanOpen,
    isBusy: hasSelectedFile || isAxnosOpen || isKlecksOpen || isHacchanOpen,
    isPopupFormCollapsed: extras.isPopupFormCollapsed,
  }
}

/**
 * 外部描画のツールバーが「今どのボタンを出すべきか」を伝えるためのヒント。
 * v2の`upfile-input-v2`はUIを内部で描画しないので、この型の値をイベントで流すだけ。
 */
export interface UpfileUiHintFlags {
  /** 画像添付が許可されていない旨のラベルを出すべきか */
  showAllowImageLabel: boolean
  /** ファイル選択ボタンを出すべきか */
  showUpfileButton: boolean
  /** お絵描きボタンを出すべきか */
  showPaintButton: boolean
  /** 貼付ボタンを出すべきか */
  showPasteButton: boolean
  /** クリアボタンを出すべきか */
  showClearButton: boolean
}

/** toUpfileUiHintFlagsの外部入力 */
export interface UpfileUiHintExtras {
  /** 画像添付を許可するかどうか (falseならお絵描きのみ) */
  allowImageReplies: boolean
}

/**
 * 現在のモードと外部情報から、外部ツールバーに「どのボタンを出すべきか」の
 * ヒントを導出する。`getShownControls`との違いは、画像添付が許可されていない
 * 場合の非表示判定・ラベル表示の扱いを吸収する点。
 */
export function toUpfileUiHintFlags(
  mode: UpfileMode,
  extras: UpfileUiHintExtras,
): UpfileUiHintFlags {
  const controls = getShownControls(mode)
  const { allowImageReplies } = extras
  return {
    showAllowImageLabel: !allowImageReplies,
    showUpfileButton: allowImageReplies && controls.upfileInput,
    showPaintButton: controls.paintButton,
    showPasteButton: allowImageReplies && controls.pasteButton,
    showClearButton: controls.clearButton,
  }
}

/** 添付ファイルorお絵描き関係の操作 */
export type UpfileAction =
  | "file-selected"
  | "paint-finished"
  | "image-pasted"
  | "paste-button-clicked"
  | "paint-button-clicked"
  | "klecks-button-clicked"
  | "hacchan-button-clicked"
  | "clear-button-clicked"
  | "submitted"

/** 各要素の表示状態。同じtrue/falseでも表示/非表示と生成/削除があって微妙に意味が違うがビュー側に任せる */
export interface UpfileControlState {
  /** ファイル選択のinput */
  upfileInput: boolean
  /** お絵描きボタン */
  paintButton: boolean
  /** 貼付ボタン */
  pasteButton: boolean
  /** クリアボタン */
  clearButton: boolean
  /** はっちゃん用の隠しボタン */
  hacchanButton: boolean
  /** はっちゃん用のキャンバス */
  oejsCanvas: boolean
  /** はっちゃん用の隠しフォーム要素 */
  baseformInput: boolean
  /** 画像プレビュー */
  previewFigure: boolean
  /** アクノスペイントのポップアップウィンドウが開いているかどうか */
  axnosPaintWindow: boolean
  /** Klecksのポップアップウィンドウが開いているかどうか */
  klecksPaintWindow: boolean
}

/** モードで表示or生成する要素 */
export function getShownControls(mode: UpfileMode): UpfileControlState {
  switch (mode) {
    case "empty":
      return {
        upfileInput: true,
        paintButton: true,
        pasteButton: true,
        clearButton: false,
        hacchanButton: true,
        oejsCanvas: false,
        baseformInput: false,
        previewFigure: false,
        axnosPaintWindow: false,
        klecksPaintWindow: false,
      }
    case "file-attached":
      return {
        upfileInput: false,
        paintButton: false,
        pasteButton: false,
        clearButton: true,
        hacchanButton: false,
        oejsCanvas: false,
        baseformInput: false,
        previewFigure: true,
        axnosPaintWindow: false,
        klecksPaintWindow: false,
      }
    case "waiting-axnos":
      return {
        upfileInput: false,
        paintButton: false,
        pasteButton: false,
        clearButton: true,
        hacchanButton: false,
        oejsCanvas: false,
        baseformInput: false,
        previewFigure: false,
        axnosPaintWindow: true,
        klecksPaintWindow: false,
      }
    case "waiting-klecks":
      return {
        upfileInput: false,
        paintButton: false,
        pasteButton: false,
        clearButton: true,
        hacchanButton: false,
        oejsCanvas: false,
        baseformInput: false,
        previewFigure: false,
        axnosPaintWindow: false,
        klecksPaintWindow: true,
      }
    case "waiting-hacchan":
      return {
        upfileInput: false,
        paintButton: false,
        pasteButton: false,
        clearButton: true,
        hacchanButton: true,
        oejsCanvas: true,
        baseformInput: true,
        previewFigure: false,
        axnosPaintWindow: false,
        klecksPaintWindow: false,
      }
  }
}

/**
 * 添付ファイル関係の受付モードの遷移をする
 * @param mode 現在のモード
 * @param action 発生した操作
 * @returns 遷移後のモード
 */
export function nextMode(mode: UpfileMode, action: UpfileAction): UpfileMode {
  switch (mode) {
    case "empty":
      switch (action) {
        case "file-selected":
        case "image-pasted":
          return "file-attached"
        case "paint-button-clicked":
          return "waiting-axnos"
        case "klecks-button-clicked":
          return "waiting-klecks"
        case "hacchan-button-clicked":
          return "waiting-hacchan"
        default:
          return mode
      }
    case "file-attached":
      switch (action) {
        case "clear-button-clicked":
        case "submitted":
          return "empty"
        case "paint-button-clicked":
          return "waiting-axnos"
        case "klecks-button-clicked":
          return "waiting-klecks"
        default:
          return mode
      }
    case "waiting-axnos":
      switch (action) {
        case "paint-finished":
          return "file-attached"
        case "clear-button-clicked":
        case "submitted":
          return "empty"
        default:
          return mode
      }
    case "waiting-klecks":
      switch (action) {
        case "paint-finished":
          return "file-attached"
        case "clear-button-clicked":
        case "submitted":
          return "empty"
        default:
          return mode
      }
    case "waiting-hacchan":
      switch (action) {
        case "clear-button-clicked":
        case "submitted":
          return "empty"
        default:
          return mode
      }
  }
}
