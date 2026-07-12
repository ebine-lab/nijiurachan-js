/**
 * カスタムエレメントのコンストラクタ
 * モジュール読み込み時すぐには登録せず、`define`を呼び出すことで定義する形に統一します
 *
 * @see https://github.com/webcomponents-cg/community-protocols/blob/main/proposals/on-demand-definitions.md
 */
export interface CustomElementClass extends CustomElementConstructor {
  /** カスタムエレメントをレジストリに登録する */
  define(): void
}
