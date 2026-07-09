/** @jsxImportSource preact */
import type { FunctionComponent, JSX, VNode } from "preact"
import type { Dispatch } from "preact/hooks"
import {
    useEffect,
    useLayoutEffect,
    useMemo,
    useReducer,
    useRef,
    useState,
} from "preact/hooks"
import type {
    UpfileAction,
    UpfileStateFlags,
    UpfileUiHintFlags,
} from "#js/pure/upfile"
import {
    getShownControls,
    nextMode,
    toUpfileStateFlags,
    toUpfileUiHintFlags,
} from "#js/pure/upfile"
import {
    abortPaintPopups,
    isPaintPopupAvailable,
    type OekakiPaintPopupConfig,
    resolvePaintPopup,
    selectedPaintAction,
} from "./oekaki-paint-popup"
import type { OekakiTool } from "./types"

/**
 * `upfile-input-v2`要素に外から叩き込むコマンド群。
 * fragment側が`bindCommands`で実装を差し込み、element側がhost methodとして公開する。
 */
export interface UpfileV2Commands {
    /** 隠し`<input type=file>`をクリックしてOSのファイルピッカーを開く */
    clickFileattach(): void
    /** お絵描きボタンが押されたのと等価 (アクノスペイントを起動) */
    clickPaint(): void
    /** Klecksを起動 */
    clickKlecks(): void
    /** 貼付ボタンが押されたのと等価 (クリップボードから画像を取り込む) */
    clickPaste(): void
    /** クリアボタンが押されたのと等価 (emptyモードに戻す) */
    clickClear(): void
}

/** v2添付File欄の動作に必要な設定 */
export type UpfileInputV2Props = {
    /** 添付File欄が所属するフォーム要素 */
    form: HTMLFormElement
    /** 画像添付を許可するならtrue、お絵描きのみならfalse */
    allowImageReplies: boolean
    /** はっちゃんキャンバス幅 */
    canvasWidth: number
    /** はっちゃんキャンバス高さ */
    canvasHeight: number
    /** 状態変化時に呼ばれる (element側が`aimg:upfile-state`発火に使う) */
    onStateChange?: (flags: UpfileStateFlags) => void
    /** UI推奨フラグが変わった時に呼ばれる (element側が`aimg:upfile-ui-hint`発火に使う) */
    onUiHintChange?: (hint: UpfileUiHintFlags) => void
    /** マウント時、外から叩くためのコマンド実装を受け取るコールバック */
    bindCommands?: (cmds: UpfileV2Commands) => void
}

/**
 * v2添付File欄の中身。UIボタン (🎨お絵かき / 📋貼付 / 🗑クリア / 画像添付不可label /
 * 可視fileinput) は**描画しない**。外部ツールバーが`aimg:upfile-ui-hint`を購読して
 * 自前で描画する想定。
 *
 * 保持するDOMは:
 * - 隠し`<input type="file" name="upfile">` (formに値を持たせるため)
 * - はっちゃん用`<button id=oebtnj>` / `<input id=baseform>` / `<figure id=ftbl>`+`<canvas id=oejs>`
 */
export const makeUpfileInputFragmentV2 = (
    paintPopups: OekakiPaintPopupConfig,
): FunctionComponent<UpfileInputV2Props> =>
    function UpfileInputFragmentV2(props: UpfileInputV2Props): VNode {
        const [mode, reducerDispatch] = useReducer(nextMode, "empty")
        const controls = useMemo(() => getShownControls(mode), [mode])
        const upfileRef = useRef<HTMLInputElement>(null)
        const baseformRef = useRef<HTMLInputElement>(null)
        const canvasRef = useRef<HTMLCanvasElement>(null)
        const [previewBlob, setPreviewBlob] = useState<File | null>(null)
        const [isPopupFormCollapsed, setIsPopupFormCollapsed] = useState(false)

        // biome-ignore lint/correctness/useExhaustiveDependencies: listen系は内部closureだが本体はrefs/safeなclosureしか触らないので、props.formの変化時のみ再subscribeすれば十分
        useEffect(() => listenSubmit(props.form), [props.form])
        useEffect(
            () => listenPopupFormToggled(props.form, setIsPopupFormCollapsed),
            [props.form],
        )
        // biome-ignore lint/correctness/useExhaustiveDependencies: unmount cleanup
        useEffect(() => (): void => abortOpenPaint(), [])
        // biome-ignore lint/correctness/useExhaustiveDependencies: onStateChangeの参照変化では再発火しない
        useEffect(() => {
            props.onStateChange?.(
                toUpfileStateFlags(mode, { isPopupFormCollapsed }),
            )
        }, [mode, isPopupFormCollapsed])
        // biome-ignore lint/correctness/useExhaustiveDependencies: onUiHintChangeの参照変化では再発火しない
        useEffect(() => {
            props.onUiHintChange?.(
                toUpfileUiHintFlags(mode, {
                    allowImageReplies: props.allowImageReplies,
                }),
            )
        }, [mode, props.allowImageReplies])
        // bindCommands で渡したクロージャは"マウント時の閉包"を持つ。dispatchやcontrolsは
        // 毎レンダ作り直されるので、外から呼ばれたとき最新の値で動くようrefで遅延参照する。
        const dispatchRef = useRef(dispatch)
        dispatchRef.current = dispatch
        const modeRef = useRef(mode)
        modeRef.current = mode
        const controlsRef = useRef(controls)
        controlsRef.current = controls
        const paintPopupGenerationRef = useRef(0)
        // biome-ignore lint/correctness/useExhaustiveDependencies: one-shot on mount (refsで最新参照)
        useLayoutEffect(() => {
            props.bindCommands?.({
                clickFileattach: () => {
                    if (!controlsRef.current.upfileInput) {
                        console.warn(
                            "[upfile-input-v2] clickFileattach: 現在のモードではファイル添付不可なので無視",
                        )
                        return
                    }
                    upfileRef.current?.click()
                },
                clickPaint: () =>
                    dispatchRef.current(selectedPaintAction(paintPopups)),
                clickKlecks: () => {
                    if (!isPaintPopupAvailable(paintPopups, "klecks")) {
                        console.warn(
                            "[upfile-input-v2] clickKlecks: Klecks popup is not configured",
                        )
                        return
                    }
                    dispatchRef.current("klecks-button-clicked")
                },
                clickPaste: () => dispatchRef.current("paste-button-clicked"),
                clickClear: () => dispatchRef.current("clear-button-clicked"),
            })
        }, [])

        // biome-ignore lint/correctness/useExhaustiveDependencies: controlsがmode由来なのを残したい
        useEffect(() => {
            if (!props.allowImageReplies) {
                return
            }
            return listenPaste(acceptPaste)
        }, [
            props.allowImageReplies,
            controls.pasteButton,
            controls.upfileInput,
        ])

        // biome-ignore lint/correctness/useExhaustiveDependencies: propsの他フィールドが変わっただけで再welcomeしたくない
        useLayoutEffect(() => {
            if (controls.oejsCanvas) {
                welcomeHacchan(canvasRef.current, props)
            }
        }, [controls.oejsCanvas])

        return (
            <>
                <input
                    ref={upfileRef}
                    type="file"
                    name="upfile"
                    accept={
                        props.allowImageReplies
                            ? "image/*,video/mp4,video/webm"
                            : "image/png,image/webp"
                    }
                    hidden
                    onChange={() => dispatch("file-selected")}
                />

                <button
                    hidden
                    id={controls.hacchanButton ? "oebtnj" : ""}
                    onClick={() => dispatch("hacchan-button-clicked")}
                    type="button"
                />

                <input
                    id={controls.baseformInput ? "baseform" : ""}
                    type="hidden"
                    ref={baseformRef}
                />

                <figure
                    id="ftbl"
                    hidden={!controls.oejsCanvas && !controls.previewFigure}
                    style={{ width: "fit-content", position: "relative" }}
                >
                    {controls.oejsCanvas && (
                        <canvas
                            ref={canvasRef}
                            id={isPopupFormCollapsed ? "" : "oejs"}
                        />
                    )}
                    {!controls.oejsCanvas &&
                        controls.previewFigure &&
                        previewBlob && <PreviewMedia file={previewBlob} />}
                </figure>
            </>
        )

        /** ペーストされた画像を受け取る */
        function acceptPaste(image: Blob | undefined): void {
            if (image && controls.pasteButton && controls.upfileInput) {
                setImage("paste", upfileRef.current, image)
                dispatch("image-pasted")
            } else {
                console.warn("paste ignored", {
                    image,
                    pasteButton: controls.pasteButton,
                    upfileInput: controls.upfileInput,
                })
            }
        }

        /** フォーム送信関係のイベントを設定する */
        function listenSubmit(form: HTMLFormElement): () => void {
            const abort = new AbortController()
            const opts = { signal: abort.signal }

            form.addEventListener("aimg:prepare-submit", prepareSubmit, opts)

            form.addEventListener(
                "aimg:submitted",
                () => dispatch("submitted"),
                opts,
            )

            return () => abort.abort()
        }

        /** フォーム送信のとき使う。canvasやbaseformを変換してupfileに設定する */
        function prepareSubmit(
            e: CustomEvent<{ preparing?: Promise<void> }>,
        ): void {
            e.detail.preparing = prepareHacchanImage()?.then((blob) =>
                setImage("oekaki98", upfileRef.current, blob),
            )
        }

        /** はっちゃんの出力する画像 (キャンバスorAPNG) を読み取る */
        function prepareHacchanImage(): Promise<Blob> | undefined {
            if (baseformRef.current?.value) {
                const dataUrl = `data:image/png;base64,${baseformRef.current.value}`
                return fetch(dataUrl).then((res) => res.blob())
            } else if (canvasRef.current) {
                const canvas = canvasRef.current
                return new Promise((resolve, reject) => {
                    try {
                        canvas.toBlob(
                            (blob) => {
                                if (blob) {
                                    resolve(blob)
                                } else {
                                    reject(
                                        Error(
                                            "Failed to convert canvas to blob",
                                        ),
                                    )
                                }
                            },
                            "image/webp",
                            1,
                        )
                    } catch (err) {
                        reject(err)
                    }
                })
            }
        }

        /** ポップアップ型のお絵描きツールをクリック操作中に表示する */
        function openPaint(tool: OekakiTool): void {
            abortOpenPaint()
            const generation = paintPopupGenerationRef.current
            const { popup, fileTool } = resolvePaintPopup(paintPopups, tool)

            popup
                .popup(props)
                .then((image) => {
                    if (paintPopupGenerationRef.current !== generation) {
                        return
                    }
                    setImage(fileTool, upfileRef.current, image)
                    dispatch("paint-finished")
                })
                .catch((e) => {
                    if (paintPopupGenerationRef.current !== generation) {
                        return
                    }
                    console.warn(e)
                    dispatch("clear-button-clicked")
                })
        }

        function abortOpenPaint(): void {
            paintPopupGenerationRef.current += 1
            abortPaintPopups(paintPopups)
        }

        /** 各アクションが起きたとき一緒にやる処理 */
        function dispatch(action: UpfileAction): void {
            if (onDispatch(action) === false) {
                return
            }
            modeRef.current = nextMode(modeRef.current, action)
            reducerDispatch(action)
        }

        /** 各操作があったら遷移前にやる処理 */
        function onDispatch(action: UpfileAction): boolean | undefined {
            switch (action) {
                case "paste-button-clicked":
                    pasteFromClipboard(navigator.clipboard)
                        .then(acceptPaste)
                        .catch(console.warn)
                    return
                case "clear-button-clicked":
                    abortOpenPaint()
                    if (upfileRef.current) {
                        upfileRef.current.value = ""
                    }
                    // baseform input は (controls.baseformInput が false でも) DOM 上に
                    // 残り続けるので value を明示クリア。これを忘れると、はっちゃんで
                    // 描いた直後に clear → 通常ファイル添付 → submit したとき、prepareSubmit が
                    // 古い baseform 値を拾って upfile を上書きしてしまう。
                    if (baseformRef.current) {
                        baseformRef.current.value = ""
                    }
                    setPreviewBlob(null)
                    return
                case "file-selected":
                    setPreviewBlob(pickPreviewable(upfileRef.current))
                    return
                case "hacchan-button-clicked":
                    if (!controls.oejsCanvas) {
                        setPreviewBlob(null)
                    }

                    // JS側で反応できるようイベント発行
                    props.form.dispatchEvent(
                        new CustomEvent("aimg:hacchan-start", {
                            bubbles: true,
                        }),
                    )
                    return
                case "submitted":
                    abortOpenPaint()
                    // 投稿成功後、再submit時に古いはっちゃん画像を再注入しないよう baseform をクリア。
                    // (clear-button-clicked は通らないので明示)
                    if (baseformRef.current) {
                        baseformRef.current.value = ""
                    }
                    return
                case "paint-finished":
                case "image-pasted":
                    return
                case "paint-button-clicked":
                    if (!canOpenPaint("axnos", action)) {
                        return false
                    }
                    openPaint("axnos")
                    return
                case "klecks-button-clicked":
                    if (!canOpenPaint("klecks", action)) {
                        return false
                    }
                    openPaint("klecks")
                    return
            }
        }

        function canOpenPaint(tool: OekakiTool, action: UpfileAction): boolean {
            if (nextMode(modeRef.current, action) === modeRef.current) {
                return false
            }
            if (!isPaintPopupAvailable(paintPopups, tool)) {
                console.warn(
                    `[upfile-input-v2] ${tool} popup is not configured`,
                )
                return false
            }
            return true
        }
    }

/** ページ全体で貼り付け(Ctrl+V)を捕まえる */
function listenPaste(dispatch: Dispatch<Blob>): () => void {
    const abort = new AbortController()
    document.addEventListener(
        "paste",
        async (e) => {
            const items = e.clipboardData?.items
            const found =
                items &&
                findImage(
                    items,
                    (item, type) => item.type === type && item.getAsFile(),
                )
            const blob = await found
            if (blob) {
                dispatch(blob)
            }
        },
        { signal: abort.signal },
    )

    return () => abort.abort()
}

/** fileInputに画像を設定する */
function setImage(
    tool: string,
    fileInput: HTMLInputElement | null,
    image: Blob,
): void {
    if (!fileInput) {
        return
    }

    const dataTransfer = new DataTransfer()
    const ext = image.type.split("/", 2)[1]
    const type = `${image.type}+${tool}`
    const file = new File([image], `${tool}_${Date.now()}.${ext}`, { type })
    dataTransfer.items.add(file)

    fileInput.files = dataTransfer.files
    fileInput.dispatchEvent(new Event("change", { bubbles: true }))
}

/** 貼付ボタンを押したとき使う。クリップボードから画像を読み出す */
async function pasteFromClipboard(
    clipboard: Clipboard,
): Promise<Blob | undefined> {
    try {
        const clipboardItems = await clipboard.read()
        const found = findImage(
            clipboardItems,
            (item, type) => item.types.includes(type) && item.getType(type),
        )
        if (found) {
            return found
        } else {
            console.info("クリップボードに画像がありませんでした")
        }
    } catch (e) {
        console.warn("クリップボード読み取りエラー:", e)
        alert(
            "クリップボードが読み取れませんでした。\nブラウザの権限設定を確認してください。\nコメント欄で貼り付け(Ctrl+V or Cmd+V)する操作もお試しください。",
        )
    }
}

/** itemsの中から画像データを探す */
function findImage<T>(
    items: Iterable<T>,
    tryRead: (item: T, type: string) => Blob | Promise<Blob> | null | false,
): Blob | Promise<Blob> | undefined {
    const types = [
        "image/webp",
        "image/png",
        "image/gif",
        "image/jpeg",
        "image/bmp",
    ]
    for (const item of items) {
        for (const type of types) {
            const blob = tryRead(item, type)
            if (blob) {
                return Promise.resolve(blob)
                    .then(tryReencodeWebp)
                    .catch(() => blob)
            }
        }
    }
}

/**
 * 選択中ファイルから「プレビュー対象 (画像 or 動画)」だけを抜き出す。
 * それ以外 (PDF等) や未選択は `null` を返す。
 */
function pickPreviewable(input: HTMLInputElement | null): File | null {
    const file = input?.files?.[0]
    if (!file) {
        return null
    }
    if (file.type.startsWith("image/") || file.type.startsWith("video/")) {
        return file
    }
    return null
}

const previewMediaStyle: JSX.CSSProperties = {
    maxWidth: "150px",
    maxHeight: "150px",
    display: "block",
}
const previewSpacerStyle: JSX.CSSProperties = {
    display: "block",
    height: "1lh",
    width: "1px",
    visibility: "hidden",
    marginTop: "2px",
}
// プレビュー画像/動画の幅に figure を shrink-wrap させ、ボタン等を隣接配置できる
// 意匠を維持するために、ファイル名はテキスト折り返しではなく `displayName` の文字数
// 制限 (20字) によってはみ出しを防いでいる。そのため `whiteSpace: "nowrap"` を維持する。
const previewInfoStyle: JSX.CSSProperties = {
    position: "absolute",
    left: 0,
    top: "calc(100% - 1lh)",
    maxWidth: "100vw",
    color: "#666",
    whiteSpace: "nowrap",
}

/**
 * 選択ファイルのプレビューを figure(id=ftbl) の子として描画する。
 *
 * - `<img>` / `<video>` は通常のブロック子。親 figure は `width: fit-content` で
 *   この要素の幅に shrink-wrap される。
 * - ファイル名・サイズ表示の `<small>` (info) は `position: absolute` で
 *   配置し、figure の幅計算には関与しない (= figure が常に img 幅にフィット)。
 *   `max-width: 100vw` で画面幅に達したら折り返す。
 * - info を absolute にすると縦幅が flow から消えるので、同じ行高の透明な
 *   `<small>` (spacer) を flow に置き、縦幅 1 行分だけ figure 高さに反映する。
 *
 * 親 figure 側で `position: relative` を指定しておく必要がある (要素 JSX 参照)。
 *
 * blob URL は `useMemo` で file 変化時にだけ作り直し、unmount/file 切替時に
 * `useEffect` の cleanup で `revokeObjectURL` する。
 */
function PreviewMedia({ file }: { file: File }): VNode {
    const url = useMemo(() => URL.createObjectURL(file), [file])
    useEffect(() => {
        return (): void => {
            URL.revokeObjectURL(url)
        }
    }, [url])

    const isVideo = file.type.startsWith("video/")
    const sizeKb = (file.size / 1024).toFixed(1)
    const displayName =
        file.name.length > 20 ? `${file.name.substring(0, 20)}...` : file.name

    return (
        <>
            {isVideo ? (
                <video src={url} controls muted style={previewMediaStyle} />
            ) : (
                <img src={url} alt="" style={previewMediaStyle} />
            )}
            <small style={previewSpacerStyle} />
            <small style={previewInfoStyle}>
                {displayName} ({sizeKb}KB)
            </small>
        </>
    )
}

function welcomeHacchan(
    canvas: HTMLCanvasElement | null,
    {
        canvasWidth,
        canvasHeight,
    }: { canvasWidth: number; canvasHeight: number },
): void {
    if (!canvas) {
        return
    }
    canvas.width = canvasWidth
    canvas.height = canvasHeight
    const c = canvas.getContext("2d")
    if (!c) {
        return
    }

    c.fillStyle = "#f0e0d6"
    c.fillRect(0, 0, canvas.width, canvas.height)
}

/** 投稿フォームが開閉したとき知らせる */
function listenPopupFormToggled(
    form: HTMLFormElement,
    setIsPopupFormCollapsed: Dispatch<boolean>,
): () => void {
    const abort = new AbortController()
    form.addEventListener(
        "aimg:popup-form-toggled",
        ({ detail: { isCollapsed } }) => setIsPopupFormCollapsed(isCollapsed),
        { signal: abort.signal },
    )
    return () => abort.abort()
}

/** webpで画像の再圧縮を試みる。小さくならなければ元の画像を返す */
async function tryReencodeWebp(imageBlob: Blob): Promise<Blob> {
    if (imageBlob.type === "image/webp") {
        return imageBlob
    }
    const imageBitmap = await createImageBitmap(imageBlob)
    const canvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height)
    const ctx = canvas.getContext("2d")
    if (!ctx) {
        return imageBlob
    }
    ctx.drawImage(imageBitmap, 0, 0)
    const webp = await canvas.convertToBlob({ type: "image/webp", quality: 1 })

    return webp.size < imageBlob.size ? webp : imageBlob
}
