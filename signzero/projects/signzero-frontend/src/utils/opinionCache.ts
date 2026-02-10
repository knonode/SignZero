const CACHE_KEY_PREFIX = 'signzero-known-apps-'

export function getKnownAppIds(networkId: string): bigint[] {
  try {
    const raw = localStorage.getItem(`${CACHE_KEY_PREFIX}${networkId}`)
    if (!raw) return []
    return (JSON.parse(raw) as string[]).map((id) => BigInt(id))
  } catch {
    return []
  }
}

export function addKnownAppId(networkId: string, appId: bigint): void {
  const ids = getKnownAppIds(networkId)
  if (!ids.some((id) => id === appId)) {
    ids.push(appId)
    localStorage.setItem(
      `${CACHE_KEY_PREFIX}${networkId}`,
      JSON.stringify(ids.map((id) => id.toString()))
    )
  }
}

export function removeKnownAppId(networkId: string, appId: bigint): void {
  const ids = getKnownAppIds(networkId).filter((id) => id !== appId)
  localStorage.setItem(
    `${CACHE_KEY_PREFIX}${networkId}`,
    JSON.stringify(ids.map((id) => id.toString()))
  )
}
