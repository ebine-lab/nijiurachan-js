import { persist } from "zustand/middleware"
import { createStore, type StateCreator, type StoreApi } from "zustand/vanilla"
import type { OekakiTool } from "#js/components/types"

/**
 * フロントエンド間で共有する設定値
 */
export interface SettingsState {
    /** ダークモードならtrue、ライトモードならfalse、未設定ならnull */
    darkMode: boolean | null
    /** プライバシーモードならtrue、通常ならfalse */
    privacyMode: boolean
    /** 投稿時設定しておくパスワード。記事をあとで削除するとき使う */
    deleteKey: string
    /** お絵描きボタンで開くツール */
    oekakiTool: OekakiTool
    /** ダークモードを設定 */
    setDarkMode(value: boolean | null): void
    /** プライバシーモードを設定 */
    setPrivacyMode(value: boolean): void
    /** 削除キーを設定 */
    setDeleteKey(value: string): void
    /** お絵描きボタンで開くツールを設定 */
    setOekakiTool(value: OekakiTool): void
    /** 削除キーを再生成 */
    resetDeleteKey(): void
    /** 削除パスワードを再生成＆他の値も初期値にリセット */
    resetSettings(): void
}

export type SettingsStoreApi = StoreApi<SettingsState>

/** 設定のzustand定義 */
// biome-ignore lint/nursery/useExplicitType: 型を書き出してもメリットが薄い
export const settingsStateCreator: StateCreator<SettingsState> = (set) => ({
    darkMode: null,
    deleteKey: "",
    oekakiTool: "axnos",
    privacyMode: false,
    setDarkMode: (darkMode: boolean | null): void => set({ darkMode }),
    setDeleteKey: (deleteKey: string): void => set({ deleteKey }),
    setOekakiTool: (oekakiTool: OekakiTool): void => set({ oekakiTool }),
    setPrivacyMode: (privacyMode: boolean): void => set({ privacyMode }),
    resetDeleteKey: (): void => set({ deleteKey: makeDeleteKey() }),
    resetSettings: (): void =>
        set({
            darkMode: null,
            deleteKey: makeDeleteKey(),
            oekakiTool: "axnos",
            privacyMode: false,
        }),
})

/**
 * 設定のzustandストアを作る(パーシステンス入り)
 * @param stateCreator ストアの状態とアクションを定義する関数
 * @param onRehydrateStorage ストレージから状態が復元されたときに呼ばれる関数
 */
export function createSettingsStore<T extends SettingsState>(
    stateCreator: StateCreator<T>,
    onRehydrateStorage?: (
        initState: T,
    ) => (rehydratedState?: T | undefined, error?: unknown) => void,
): StoreApi<T> {
    return createStore<T>()(
        persist(stateCreator, {
            name: "aimg-settings",
            onRehydrateStorage,
        }),
    )
}

/** ランダムに削除キーを生成 */
function makeDeleteKey(): string {
    const bytes = new Uint8Array(12)
    crypto.getRandomValues(bytes)

    return btoa(String.fromCharCode(...bytes))
}
