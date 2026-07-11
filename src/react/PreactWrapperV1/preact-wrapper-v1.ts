import { buildFullKey } from "./core/full-key"
import { CustomElementRegion } from "./custom-element-region"
import { Scope } from "./scope"
import { useEvent } from "./use-event"
import { useEventLatest } from "./use-event-latest"
import { useHost } from "./use-host"

/**
 * React/TSクライアント向けの`PreactWrapperV1`名前空間オブジェクト。
 *
 * 責務はCustom Elementの汎用ブリッジに限定:
 *   1. Preactパーツを扱うための箱 (`CustomElementRegion`)
 *   2. ハンドラ外部購読の窓口 (`useEvent`)
 *   3. フラグ/直近detailの受け渡し窓口 (`useEventLatest`)
 *   4. Reactに管理されないCustom Elementを置くための窓口 (`CustomElementRegion`)
 *   5. 名前空間の窓口 (`Scope` / `buildFullKey`)
 *   6. imperativeなhost操作のescape hatch (`useHost`)
 *
 * 特定要素 (upfile-input等) についてのユーティリティはここでは定義しない。
 *
 * 破壊変更が必要になった場合は`PreactWrapperV2`を別ファイル/別exportで新設する。
 */
export const PreactWrapperV1 = {
  Scope,
  CustomElementRegion,
  useEvent,
  useEventLatest,
  useHost,
  buildFullKey,
} as const
