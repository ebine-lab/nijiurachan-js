import { spawn } from "node:child_process"
import { sleep } from "bun"

/** Vitestを実行する。ビルドのついでにするものなので、細かい出力はしない */
export async function runTests(): Promise<number> {
  const { promise, kill } = spawnTest()
  const code = await Promise.race([promise, sleep(5000)])

  if (code == null) {
    console.error("テストがタイムアウトしました")
    kill()
    return -1
  } else if (code) {
    console.error(`テストが失敗しました。詳細はbun run testを実行してください`)
  }
  return code
}

/** テストを実行 */
function spawnTest(): {
  promise: Promise<number>
  kill(): void
} {
  const p = spawn("bun", ["vitest", "--run", "--reporter=github-actions"], {
    stdio: "ignore",
  })

  const promise = new Promise<number>((resolve, reject) => {
    p.on("close", resolve)
    p.on("error", reject)
  })

  return {
    promise,
    kill: () => p.kill(),
  }
}
