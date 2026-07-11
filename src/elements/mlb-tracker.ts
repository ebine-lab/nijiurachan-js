const PLAYER_ID = 608070
const POLL_INTERVAL_MS = 30_000

interface SeasonStats {
  avg: string
  homeRuns: number
  rbi: number
  ops: string
}

interface PlayResult {
  event: string
  description: string
  rbi: number
  isOut: boolean
}

interface GameData {
  gamePk: number
  status: string
  atBats: PlayResult[]
  seasonStats: SeasonStats | null
}

interface ScheduleGame {
  gamePk: number
  status?: {
    detailedState?: string
    abstractGameState?: string
  }
}

/**
 * ホセ・ラミレスの本日の打席結果をMLB APIから取得して表示するカスタム要素。
 * スレッド5020専用。<mlb-tracker> として配置する。
 */
export class MLBTrackerElement extends HTMLElement {
  #timer: ReturnType<typeof setInterval> | null = null
  #isFetching = false
  #abortController: AbortController | null = null

  static define(): void {
    customElements.define("mlb-tracker", MLBTrackerElement)
  }

  connectedCallback(): void {
    this.textContent = "読み込み中..."
    void this.#fetch()
    this.#timer = setInterval(() => this.#fetch(), POLL_INTERVAL_MS)
  }

  disconnectedCallback(): void {
    if (this.#timer !== null) {
      clearInterval(this.#timer)
      this.#timer = null
    }
    this.#abortController?.abort()
    this.#abortController = null
  }

  async #fetch(): Promise<void> {
    if (this.#isFetching) return
    this.#isFetching = true
    this.#abortController?.abort()
    const controller = new AbortController()
    this.#abortController = controller
    try {
      const data = await fetchGameData(controller.signal)
      if (!controller.signal.aborted) {
        this.#render(data)
      }
    } catch {
      if (!controller.signal.aborted) {
        this.textContent = "MLB API取得エラー"
      }
    } finally {
      this.#isFetching = false
    }
  }

  #render(data: GameData): void {
    if (data.status === "no_game") {
      this.textContent = "本日ガーディアンズの試合はありません"
      return
    }

    const lines: string[] = []

    if (data.status === "scheduled") {
      lines.push("試合開始前")
    }

    if (data.atBats.length === 0 && data.status !== "scheduled") {
      lines.push("まだ打席なし")
    }
    for (const [i, ab] of data.atBats.entries()) {
      lines.push(`第${i + 1}打席: ${ab.event}`)
    }

    if (data.seasonStats) {
      const s = data.seasonStats
      lines.push(`打率${s.avg} ${s.homeRuns}HR ${s.rbi}打点 OPS${s.ops}`)
    }

    this.textContent = `José Ramírez | ${lines.join(" / ")}`
  }
}

async function fetchGameData(signal: AbortSignal): Promise<GameData> {
  // チーム本拠地TZ (America/New_York) で「本日」を判定
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date())
  const year = parts.find((p) => p.type === "year")?.value ?? "2000"
  const month = parts.find((p) => p.type === "month")?.value ?? "01"
  const day = parts.find((p) => p.type === "day")?.value ?? "01"
  const dateStr = `${year}-${month}-${day}`

  const scheduleRes = await fetch(
    `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${dateStr}&teamId=114`,
    { signal },
  )
  if (!scheduleRes.ok)
    throw new Error(`Schedule API error: ${scheduleRes.status}`)
  const schedule = await scheduleRes.json()
  const games = schedule.dates?.[0]?.games
  if (!games || games.length === 0) {
    return { gamePk: 0, status: "no_game", atBats: [], seasonStats: null }
  }

  // ダブルヘッダー対応: 進行中の試合を優先、なければ最も近い試合を選択
  const game = pickGame(games as ScheduleGame[])
  const gamePk = game.gamePk
  const detailedState = game.status?.detailedState ?? ""

  if (
    detailedState === "Scheduled" ||
    detailedState === "Pre-Game" ||
    detailedState === "Warmup"
  ) {
    const seasonStats = await fetchSeasonStats(signal)
    return { gamePk, status: "scheduled", atBats: [], seasonStats }
  }

  // ライブフィードから打席結果取得
  const [atBats, seasonStats] = await Promise.all([
    fetchAtBats(gamePk, signal),
    fetchSeasonStats(signal),
  ])

  return { gamePk, status: detailedState.toLowerCase(), atBats, seasonStats }
}

function pickGame(games: ScheduleGame[]): ScheduleGame {
  const inProgress = games.find((g) => g.status?.abstractGameState === "Live")
  if (inProgress) return inProgress

  const upcoming = games.find((g) => g.status?.abstractGameState === "Preview")
  if (upcoming) return upcoming

  // games.length >= 1 は呼び出し元で保証済み
  return games.at(-1) as ScheduleGame
}

async function fetchAtBats(
  gamePk: number,
  signal: AbortSignal,
): Promise<PlayResult[]> {
  const res = await fetch(
    `https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`,
    { signal },
  )
  if (!res.ok) throw new Error(`Live feed API error: ${res.status}`)
  const data = await res.json()
  const allPlays = data.liveData?.plays?.allPlays ?? []

  const results: PlayResult[] = []
  for (const play of allPlays) {
    if (play.matchup?.batter?.id !== PLAYER_ID) continue
    if (!play.result?.event) continue

    results.push({
      event: play.result.event,
      description: play.result.description ?? "",
      rbi: play.result.rbi ?? 0,
      isOut: play.result.isOut ?? false,
    })
  }
  return results
}

async function fetchSeasonStats(
  signal: AbortSignal,
): Promise<SeasonStats | null> {
  const season = new Date().getFullYear()
  const res = await fetch(
    `https://statsapi.mlb.com/api/v1/people/${PLAYER_ID}/stats?stats=season&season=${season}&group=hitting`,
    { signal },
  )
  if (!res.ok) throw new Error(`Stats API error: ${res.status}`)
  const data = await res.json()
  const split = data.stats?.[0]?.splits?.[0]?.stat
  if (!split) return null

  return {
    avg: split.avg ?? ".000",
    homeRuns: split.homeRuns ?? 0,
    rbi: split.rbi ?? 0,
    ops: split.ops ?? ".000",
  }
}
