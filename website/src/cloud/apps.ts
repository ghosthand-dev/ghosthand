// The app catalog: apps `ghosthand app install --app <id>` can install. One list for both
// backends (docs/cloud-phones.md, "Daemon: new CLI commands"):
//
//   cloud phone ──> api.ts ──> fleet push-url of the IPA at `key` in R2, then apps.install
//   USB iPhone  ──> daemon reads GET /api/cli/apps/catalog ──> App Store page of `appStoreId`, tap Get
//
// Adding an app here needs no daemon release. `name` must be the start of the App Store
// title: the daemon finds the page by it with OCR.

export type CatalogApp = {
  /** Short id used by the CLI and MCP, e.g. `tiktok`. */
  id: string
  name: string
  bundleId: string
  /** The number in apps.apple.com/app/id<appStoreId>. */
  appStoreId: number
  /** Decrypted IPA in the R2 bucket ghosthand-phones, for cloud phones. */
  key: string
  sha256: string
}

// TODO: real keys and hashes once the decrypted IPAs are uploaded to R2 (Task 4).
export const CATALOG_APPS: CatalogApp[] = [
  {
    id: 'tiktok',
    name: 'TikTok',
    bundleId: 'com.zhiliaoapp.musically',
    appStoreId: 835599320,
    key: 'apps/tiktok/placeholder.ipa',
    sha256: '0000000000000000000000000000000000000000000000000000000000000000',
  },
  {
    id: 'reddit',
    name: 'Reddit',
    bundleId: 'com.reddit.Reddit',
    appStoreId: 1064216828,
    key: 'apps/reddit/placeholder.ipa',
    sha256: '0000000000000000000000000000000000000000000000000000000000000000',
  },
]

export function catalogApp(id: string): CatalogApp | undefined {
  return CATALOG_APPS.find((app) => app.id === id)
}

/** What clients see: no R2 keys. */
export function publicCatalog(): { apps: Pick<CatalogApp, 'id' | 'name' | 'bundleId' | 'appStoreId'>[] } {
  return { apps: CATALOG_APPS.map(({ id, name, bundleId, appStoreId }) => ({ id, name, bundleId, appStoreId })) }
}
