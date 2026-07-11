/**
 * 開発ビルドか運用ビルドか調べられるフラグ
 * @file
 */

declare global {
  interface ImportMeta {
    /** `true` if not in production build, otherwise `false` */
    readonly DEV: boolean

    /** `true` if in production build, otherwise `false` */
    readonly PROD: boolean
  }
}
export {}
