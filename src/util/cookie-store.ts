/**
 * Cookie Store APIのポリフィル。
 * @file
 */

/** cookieStoreが無ければポリフィルを適用する */
export async function initCookieStore(): Promise<void> {
  if (window.cookieStore) {
    return
  }
  await import("cookie-store")
    .then(({ cookieStore }) => {
      window.cookieStore = cookieStore as typeof window.cookieStore
    })
    .catch(console.warn)
}
