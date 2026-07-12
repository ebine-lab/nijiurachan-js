/**
 * スコープ名とidから`registry`用のキー文字列を合成する。
 *
 * - `scopeName === undefined` (スコープ無し): `id` をそのまま返す
 * - `scopeName === ""` (空文字): スコープなしと衝突する可能性があるため明示的に拒否
 * - それ以外: `"<scopeName>:<id>"`
 */
export function buildFullKey(
  scopeName: string | undefined,
  id: string,
): string {
  if (!id) {
    throw new Error("PreactWrapperV1: id must be a non-empty string")
  }
  if (scopeName === undefined) {
    return id
  }
  if (scopeName === "") {
    throw new Error(
      "PreactWrapperV1: scopeName must be a non-empty string (scopeを使わない場合はundefinedを渡す)",
    )
  }
  return `${scopeName}:${id}`
}
