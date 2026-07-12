/**
 * Invoker Commands APIのポリフィル。
 * カスタムコマンド(名前が--で始まるもの)だけ扱うのでDOM側やdialog関係は実装しない。
 * dialog動作はpopovertarget/popovertargetaction/command/commandforを全て指定すればポリフィル不要。
 * @see https://developer.mozilla.org/docs/Web/API/Invoker_Commands_API
 * @file
 */

/** CommandEventが無ければポリフィルを適用する */
export function initCommandEvent(): void {
  if (window.CommandEvent) {
    return
  }

  window.CommandEvent = class CommandEvent extends Event {
    command: string
    source: Element | null

    constructor(type: string, options?: CommandEventInit) {
      super(type, options)
      this.command = options?.command ?? ""
      this.source = options?.source ?? null
    }
  }

  document.body.addEventListener("click", sendCommand, { passive: true })
}

/**
 * ボタンクリックをCommandEventに翻訳する
 */
function sendCommand(event: Event): boolean | undefined {
  const composedPath = event.composedPath() as HTMLElement[]
  const source = composedPath.find((n) => n.matches?.("button[command]"))
  if (!source) {
    return
  }
  const command = source.getAttribute("command")
  const commandFor = source.getAttribute("commandfor")
  const target = commandFor && source.ownerDocument.getElementById(commandFor)
  if (!target || !command?.startsWith("--")) {
    return
  }
  const e = new CommandEvent("command", {
    command,
    source,
    cancelable: true,
    composed: true,
  })
  return target.dispatchEvent(e)
}
