import { getAlgorandClient } from './algorand'
import type { NetworkId } from './algorand'

export function parseGlobalState(
  state: Array<{
    key: string | Uint8Array
    value: { type: number; uint?: number | bigint; bytes?: string | Uint8Array }
  }>
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const item of state) {
    let key: string
    if (typeof item.key === 'string') {
      key = atob(item.key)
    } else {
      key = new TextDecoder().decode(item.key)
    }

    if (item.value.type === 2) {
      result[key] = BigInt(item.value.uint || 0)
    } else {
      if (typeof item.value.bytes === 'string') {
        result[key] = atob(item.value.bytes)
      } else if (item.value.bytes) {
        result[key] = new TextDecoder().decode(item.value.bytes)
      } else {
        result[key] = ''
      }
    }
  }
  return result
}

export function isSignZeroOpinion(globalState: Record<string, unknown>): boolean {
  const requiredKeys = ['start', 'end', 'asa', 'finalized', 'init']
  return requiredKeys.every((key) => key in globalState)
}

export function decodeOpinionType(metadataHash: string | Uint8Array | undefined): string {
  if (!metadataHash) return ''
  let bytes: Uint8Array
  if (typeof metadataHash === 'string') {
    const binary = atob(metadataHash)
    bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
  } else {
    bytes = metadataHash
  }
  let end = bytes.length
  while (end > 0 && bytes[end - 1] === 0) end--
  return new TextDecoder().decode(bytes.subarray(0, end))
}

/**
 * Search indexer for a SignZero opinion app that has the given ASA ID in its global state.
 * Returns the app ID if found, null otherwise.
 */
export async function resolveAsaToAppId(
  asaId: bigint,
  networkId: NetworkId
): Promise<bigint | null> {
  const algorand = getAlgorandClient(networkId)

  // First verify the ASA exists
  try {
    await algorand.client.algod.getAssetByID(Number(asaId)).do()
  } catch {
    return null
  }

  let nextToken: string | undefined
  do {
    const searchParams = algorand.client.indexer.searchForApplications().limit(100)
    if (nextToken) {
      searchParams.nextToken(nextToken)
    }

    const response = await searchParams.do()
    const apps = response.applications || []
    nextToken = response.nextToken

    for (const app of apps) {
      const globalState = app.params?.globalState
      if (!globalState) continue

      const parsed = parseGlobalState(globalState)
      if (!isSignZeroOpinion(parsed)) continue

      if (parsed.asa === asaId) {
        return BigInt(app.id)
      }
    }
  } while (nextToken)

  return null
}
