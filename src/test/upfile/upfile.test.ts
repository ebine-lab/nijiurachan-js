import { describe, expect, test } from "vitest"
import {
    getShownControls,
    nextMode,
    type UpfileAction,
    type UpfileControlState,
    type UpfileMode,
} from "#js/pure/upfile"

describe("Upfileの判定", () => {
    const modes: UpfileMode[] = [
        "empty",
        "file-attached",
        "waiting-axnos",
        "waiting-klecks",
        "waiting-hacchan",
    ] as const
    const actions: UpfileAction[] = [
        "file-selected",
        "paint-finished",
        "image-pasted",
        "paste-button-clicked",
        "paint-button-clicked",
        "klecks-button-clicked",
        "hacchan-button-clicked",
        "clear-button-clicked",
        "submitted",
    ] as const

    describe(getShownControls, () => {
        const inputs: (keyof UpfileControlState)[] = [
            "upfileInput",
            "pasteButton",
            "paintButton",
            "hacchanButton",
            "clearButton",
        ] as const
        const axnosControls: (keyof UpfileControlState)[] = [
            "axnosPaintWindow",
        ] as const
        const klecksControls: (keyof UpfileControlState)[] = [
            "klecksPaintWindow",
        ] as const
        const hacchanControls: (keyof UpfileControlState)[] = [
            "oejsCanvas",
            "baseformInput",
        ] as const

        const listControlNames = (
            state: UpfileControlState,
        ): Set<keyof UpfileControlState> =>
            new Set(
                Object.entries(state)
                    .filter(([, v]) => v)
                    .map(([k]) => k as keyof UpfileControlState),
            )

        test("emptyのときはクリア以外のボタンが表示されること", () => {
            const shown = getShownControls("empty")
            expect(listControlNames(shown)).toEqual(
                new Set(inputs).difference(new Set(["clearButton"] as const)),
            )
        })

        test("file-attachedのときはプレビューとクリアのみ表示されること (clear押すまで再添付不可)", () => {
            const shown = getShownControls("file-attached")
            expect(listControlNames(shown)).toEqual(
                new Set(["previewFigure", "clearButton"] as const),
            )
        })

        test("waiting-axnosのときはアクノスペイントとクリアボタンが表示されること", () => {
            const shown = getShownControls("waiting-axnos")
            expect(listControlNames(shown)).toEqual(
                new Set(["clearButton", ...axnosControls] as const),
            )
        })

        test("waiting-klecksのときはKlecksとクリアボタンが表示されること", () => {
            const shown = getShownControls("waiting-klecks")
            expect(listControlNames(shown)).toEqual(
                new Set(["clearButton", ...klecksControls] as const),
            )
        })

        test("waiting-hacchanのときははっちゃん関連の要素とクリアボタンが表示されること", () => {
            const shown = getShownControls("waiting-hacchan")
            expect(listControlNames(shown)).toEqual(
                new Set([
                    "clearButton",
                    "hacchanButton",
                    ...hacchanControls,
                ] as const),
            )
        })
    })

    describe(nextMode, () => {
        const transitions: [UpfileMode, UpfileAction, UpfileMode][] = [
            ["empty", "file-selected", "file-attached"],
            ["empty", "image-pasted", "file-attached"],
            ["empty", "paint-button-clicked", "waiting-axnos"],
            ["empty", "klecks-button-clicked", "waiting-klecks"],
            ["empty", "hacchan-button-clicked", "waiting-hacchan"],
            ["waiting-axnos", "paint-finished", "file-attached"],
            ["waiting-axnos", "clear-button-clicked", "empty"],
            ["waiting-axnos", "submitted", "empty"],
            ["waiting-klecks", "paint-finished", "file-attached"],
            ["waiting-klecks", "clear-button-clicked", "empty"],
            ["waiting-klecks", "submitted", "empty"],
            ["file-attached", "clear-button-clicked", "empty"],
            ["file-attached", "paint-button-clicked", "waiting-axnos"],
            ["file-attached", "klecks-button-clicked", "waiting-klecks"],
            ["file-attached", "submitted", "empty"],
            ["waiting-hacchan", "clear-button-clicked", "empty"],
            ["waiting-hacchan", "submitted", "empty"],
        ]

        test.each(transitions)(
            "%s のとき %s すると %s になること",
            (mode, action, expected) => {
                expect(
                    nextMode(mode, action),
                    `nextMode(${mode}, ${action}) should return ${expected}`,
                ).toBe(expected)
            },
        )

        test("その他の操作ではモードが変わらないこと", () => {
            for (const mode of modes) {
                for (const action of actions) {
                    if (
                        transitions.some(([m, a]) => m === mode && a === action)
                    ) {
                        continue
                    }
                    expect(
                        nextMode(mode, action),
                        `nextMode(${mode}, ${action}) should return ${mode}`,
                    ).toBe(mode)
                }
            }
        })
    })
})
