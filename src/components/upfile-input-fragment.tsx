/** @jsxImportSource preact */
import type { FunctionComponent, RefObject, VNode } from "preact"
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
    UpfileControlState,
    UpfileStateFlags,
} from "#js/pure/upfile"
import { getShownControls, nextMode, toUpfileStateFlags } from "#js/pure/upfile"
import {
    abortPaintPopups,
    isPaintPopupAvailable,
    type OekakiPaintPopupConfig,
    resolvePaintPopup,
    selectedPaintAction,
} from "./oekaki-paint-popup"
import type { OekakiTool } from "./types"

/** 添付File欄の動作に必要な設定 */
export type UpfileInputProps = {
    /** 添付File欄が所属するフォーム要素 */
    form: HTMLFormElement
    /** 画像添付を許可するならtrue、お絵描きのみならfalse */
    allowImageReplies: boolean
    /** はっちゃんキャンバス幅 */
    canvasWidth: number
    /** はっちゃんキャンバス高さ */
    canvasHeight: number
    /**
     * 状態変化が起きたら呼ばれるコールバック。要素側(`UpfileInputElement`)が
     * `aimg:upfile-state`イベント発火に使う。
     * Preactフラグメント自身はDOMイベントを直接発火せずコールバック経由に留めることで、
     * テスト時の差し替えや将来の発火元変更に対応しやすくする。
     */
    onStateChange?: (flags: UpfileStateFlags) => void
}

/**
 * 添付File欄の中身。ファイル選択欄とお絵描きボタンを持つ。
 * 細かい事情は{@link nextMode}参照。
 * @param axnosPaintPopup アクノスペイントを開く用の部品
 */
export const makeUpfileInputFragment = (
    paintPopups: OekakiPaintPopupConfig,
): FunctionComponent<UpfileInputProps> =>
    function UpfileInputFragment(props: UpfileInputProps): VNode {
        const [mode, reducerDispatch] = useReducer(nextMode, "empty")
        const controls = useMemo(() => getShownControls(mode), [mode])
        const upfileRef = useRef<HTMLInputElement>(null)
        const baseformRef = useRef<HTMLInputElement>(null)
        const canvasRef = useRef<HTMLCanvasElement>(null)
        const previewFigureRef = useRef<HTMLElement>(null)
        const [isPopupFormCollapsed, setIsPopupFormCollapsed] = useState(false)
        const modeRef = useRef(mode)
        modeRef.current = mode
        const paintPopupGenerationRef = useRef(0)

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

        return renderUpfile(
            props,
            upfileRef,
            canvasRef,
            previewFigureRef,
            baseformRef,
            controls,
            isPopupFormCollapsed,
            dispatch,
            paintPopups,
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
                    return
                case "file-selected":
                    previewFile(upfileRef.current, previewFigureRef.current)
                    return
                case "hacchan-button-clicked":
                    if (!controls.oejsCanvas) {
                        previewFile(null, previewFigureRef.current)
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
                console.warn(`[upfile-input] ${tool} popup is not configured`)
                return false
            }
            return true
        }
    }

/** UpfileInputを描画する */
function renderUpfile(
    { allowImageReplies }: UpfileInputProps,
    upfileRef: RefObject<HTMLInputElement>,
    canvasRef: RefObject<HTMLCanvasElement>,
    previewFigureRef: RefObject<HTMLElement>,
    baseformRef: RefObject<HTMLInputElement>,
    controls: UpfileControlState,
    isPopupFormCollapsed: boolean,
    dispatch: Dispatch<UpfileAction>,
    paintPopups: OekakiPaintPopupConfig,
): VNode {
    // TODO: It should be the other way around; make this the entry function that calls the init stuff above
    return (
        <>
            <aside hidden={allowImageReplies}>
                画像添付は許可されていません（お絵描きは可能）
            </aside>

            <input
                ref={upfileRef}
                type="file"
                name="upfile"
                size={25}
                accept={
                    allowImageReplies
                        ? "image/*,video/mp4,video/webm"
                        : "image/png,image/webp"
                }
                hidden={!allowImageReplies || !controls.upfileInput}
                onChange={() => dispatch("file-selected")}
            />

            <button
                class="paint-btn"
                hidden={!controls.paintButton}
                disabled={!controls.paintButton}
                onClick={() => dispatch(selectedPaintAction(paintPopups))}
                type="button"
                // biome-ignore lint/correctness/noChildrenProp: v1保持 (v2で解消済み)
                children="🎨お絵かき"
            />

            <button
                class="paste-btn"
                hidden={!allowImageReplies || !controls.pasteButton}
                disabled={!allowImageReplies || !controls.pasteButton}
                onClick={() => dispatch("paste-button-clicked")}
                type="button"
                // biome-ignore lint/correctness/noChildrenProp: v1保持 (v2で解消済み)
                children="📋貼付"
            />

            <button
                class="clear-btn"
                hidden={!controls.clearButton}
                onClick={() => dispatch("clear-button-clicked")}
                type="button"
                // biome-ignore lint/correctness/noChildrenProp: v1保持 (v2で解消済み)
                children="🗑クリア"
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
                ref={previewFigureRef}
                hidden={!controls.oejsCanvas && !controls.previewFigure}
                style={{ width: "fit-content" }}
            >
                {controls.oejsCanvas && (
                    <canvas
                        ref={canvasRef}
                        id={isPopupFormCollapsed ? "" : "oejs"}
                    />
                )}
            </figure>
        </>
    )
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

/**
 * fileInputに画像を設定する
 * @param tool ファイルの出所
 * @param fileInput 画像を設定するファイル選択欄
 * @param image 設定する画像データ
 */
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

/**
 * itemsの中から画像データを探す
 * @param items 探す対象
 * @param tryRead MIMEタイプの画像を読み出そうとする関数(失敗したらfalsyな値を返す)
 * @return 見つかった画像データ、なければundefined
 */
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
 * `preview.dataset.lastObjectUrl` に残っている blob URL があれば revoke + 削除する。
 * `previewFile` が再呼び出しされた時に「まだ onload/onerror が来ていない URL」を
 * リークさせないために使う。
 */
function revokePreviousObjectUrl(preview: HTMLElement): void {
    const prev = preview.dataset.lastObjectUrl
    if (prev) {
        URL.revokeObjectURL(prev)
        delete preview.dataset.lastObjectUrl
    }
}

/**
 * 選択されたファイルのプレビューを表示する
 * @param input ファイル選択欄
 * @param preview プレビューを差し込む要素
 */
function previewFile(
    input: HTMLInputElement | null,
    preview: HTMLElement | null,
): void {
    // TODO: make the preview a React component too

    if (!preview) {
        return
    }

    const file = input?.files?.[0]
    const isVideo = file?.type.startsWith("video/")
    const isImage = file?.type.startsWith("image/")

    // 直前の呼び出しで作った blob URL がまだ revoke されていない可能性があるので、
    // innerHTML を捨てる前に revoke する (onload/onerror が来る前に置換された場合のリーク防止)。
    revokePreviousObjectUrl(preview)

    preview.innerHTML = ""

    if (!file || (!isVideo && !isImage)) {
        return
    }

    const url = URL.createObjectURL(file)
    preview.dataset.lastObjectUrl = url
    // 成功 (onload/onloadeddata) でも失敗 (onerror) でも、当該 URL を revoke して
    // dataset から外す。dataset の値が他の URL に置換済みなら触らない (古い load の遅延発火対策)。
    const clean = (): void => {
        URL.revokeObjectURL(url)
        if (preview.dataset.lastObjectUrl === url) {
            delete preview.dataset.lastObjectUrl
        }
    }

    if (isVideo) {
        const video = document.createElement("video")
        video.src = url
        video.controls = true
        video.muted = true
        video.style.cssText = "max-width:150px;max-height:150px;display:block;"
        video.onloadeddata = clean
        video.onerror = clean
        preview.appendChild(video)
    } else {
        const img = document.createElement("img")
        img.src = url
        img.style.cssText = "max-width:150px;max-height:150px;display:block;"
        img.onload = clean
        img.onerror = clean
        preview.appendChild(img)
    }

    const info = document.createElement("small")
    const size = (file.size / 1024).toFixed(1)
    // TODO: Should use CSS ellipsis instead of substring
    info.textContent =
        file.name.substring(0, 20) +
        (file.name.length > 20 ? "..." : "") +
        " (" +
        size +
        "KB)"
    info.style.cssText = "display:block;color:#666;margin-top:2px;"
    preview.appendChild(info)
}

function welcomeHacchan(
    canvas: HTMLCanvasElement | null,
    { canvasWidth, canvasHeight }: UpfileInputProps,
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
