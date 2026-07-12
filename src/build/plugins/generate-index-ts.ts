import { createUnplugin, type UnpluginInstance } from "unplugin"
import {
  type GenerateIndexTsOptions,
  generateIndexTs,
} from "./generate-index-ts-detail"

/** generateIndexTsをビルドツールで使えるプラグインにしたもの */
export const generateIndexTsUnplugin: UnpluginInstance<
  GenerateIndexTsOptions,
  false
> = createUnplugin((opts: GenerateIndexTsOptions) => ({
  name: "generateIndexTs",
  buildStart: () => generateIndexTs(opts),
}))
