import { useState, useEffect } from 'react'
import { getAlgorandClient } from '../utils/algorand'
import type { NetworkId } from '../utils/algorand'
import { SignZeroClient } from '../contracts/SignZeroClient'
import { lookupNFD, truncateAddress, batchLookupNFD } from '../utils/nfd'

interface OpinionListProps {
  networkId: NetworkId
  onViewOpinion: (appId: bigint) => void
}

interface OpinionSummary {
  appId: bigint
  title: string
  opinionType: string
  author: string
  authorNfd: string | null
  signatureCount: number
  isActive: boolean
  isFinalized: boolean
}

// Keep localStorage as a cache for quick loading, but fetch from indexer
const STORAGE_KEY = 'signzero_opinions'

export function saveOpinionId(appId: bigint) {
  const stored = localStorage.getItem(STORAGE_KEY)
  const ids: string[] = stored ? JSON.parse(stored) : []
  const idStr = appId.toString()
  if (!ids.includes(idStr)) {
    ids.unshift(idStr)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
  }
}

// Check if an app has SignZero global state structure
function isSignZeroOpinion(globalState: Record<string, unknown>): boolean {
  // Keys are: init, finalized, end, asa, start
  const requiredKeys = ['start', 'end', 'asa', 'finalized', 'init']
  return requiredKeys.every((key) => key in globalState)
}

function decodeOpinionType(metadataHash: string | Uint8Array | undefined): string {
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

// Parse global state from indexer response (handles both formats)
function parseGlobalState(state: Array<{ key: string | Uint8Array; value: { type: number; uint?: number | bigint; bytes?: string | Uint8Array } }>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const item of state) {
    // Key can be base64 string or Uint8Array
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

export function OpinionList({ networkId, onViewOpinion }: OpinionListProps) {
  const [opinions, setOpinions] = useState<OpinionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadOpinions()
  }, [networkId])

  const loadOpinions = async () => {
    setLoading(true)
    setError(null)

    try {
      const algorand = getAlgorandClient(networkId)
      const loaded: OpinionSummary[] = []

      // Get current round first
      const status = await algorand.client.algod.status().do()
      const currentRound = BigInt(status.lastRound)

      // Query indexer for all applications and filter for SignZero opinions
      let nextToken: string | undefined
      const maxApps = 50 // Limit to prevent too many requests

      do {
        const searchParams = algorand.client.indexer.searchForApplications().limit(100)
        if (nextToken) {
          searchParams.nextToken(nextToken)
        }

        const response = await searchParams.do()
        const apps = response.applications || []
        nextToken = response.nextToken

        for (const app of apps) {
          if (loaded.length >= maxApps) break

          // Check if app has global state that matches SignZero structure
          const globalState = app.params?.globalState
          if (!globalState) continue

          const parsed = parseGlobalState(globalState)
          if (!isSignZeroOpinion(parsed)) continue

          // It's a SignZero opinion
          const appId = BigInt(app.id)
          const initialized = parsed.init === 1n
          const finalized = parsed.finalized === 1n
          const endRound = parsed.end as bigint
          const asaId = parsed.asa as bigint

          if (!initialized) continue

          // Get ASA info for title, author, and type
          try {
            const assetInfo = await algorand.client.algod.getAssetByID(Number(asaId)).do()
            const title = assetInfo.params.name || 'Untitled'
            const author = assetInfo.params.reserve || ''
            const opinionType = decodeOpinionType(assetInfo.params.metadataHash)

            // Count signatures
            let signatureCount = 0
            try {
              const balances = await algorand.client.indexer
                .lookupAssetBalances(Number(asaId))
                .do()
              signatureCount = balances.balances?.length || 0
            } catch {
              // Indexer balance lookup might fail
            }

            loaded.push({
              appId,
              title,
              opinionType,
              author,
              authorNfd: null, // Will be filled in batch
              signatureCount,
              isActive: currentRound <= endRound && !finalized,
              isFinalized: finalized,
            })

            // Save to localStorage cache
            saveOpinionId(appId)
          } catch (err) {
            console.error(`Failed to load ASA info for opinion ${appId}:`, err)
          }
        }
      } while (nextToken && loaded.length < maxApps)

      // Batch lookup NFD names for all authors
      if (loaded.length > 0) {
        const authors = [...new Set(loaded.map((p) => p.author).filter(Boolean))]
        const nfdResults = await batchLookupNFD(authors)

        for (const opinion of loaded) {
          if (opinion.author && nfdResults[opinion.author]) {
            opinion.authorNfd = nfdResults[opinion.author].name
          }
        }
      }

      // Sort by appId descending (newest first)
      loaded.sort((a, b) => (b.appId > a.appId ? 1 : -1))

      setOpinions(loaded)
    } catch (err) {
      console.error('Failed to load opinions from indexer:', err)
      setError('Failed to load opinions. Indexer may not be available.')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="text-center py-8">
        <div className="animate-spin w-6 h-6 border-2 border-emerald-400 border-t-transparent rounded-full mx-auto mb-2" />
        <p className="text-gray-500 text-sm">Loading opinions from indexer...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-8 bg-red-900/20 border border-red-700/50 rounded-xl">
        <p className="text-red-400 text-sm">{error}</p>
        <button
          onClick={loadOpinions}
          className="mt-2 text-xs text-gray-400 hover:text-white underline"
        >
          Try again
        </button>
      </div>
    )
  }

  if (opinions.length === 0) {
    return (
      <div className="text-center py-12 bg-gray-800/30 border border-gray-700 rounded-xl">
        <p className="text-gray-500">No opinions found on the blockchain yet.</p>
        <p className="text-gray-600 text-sm mt-1">Create one to get started!</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {opinions.map((opinion) => (
        <button
          key={opinion.appId.toString()}
          onClick={() => onViewOpinion(opinion.appId)}
          className="w-full p-4 bg-gray-800/50 border border-gray-700 rounded-lg hover:border-emerald-500/50 hover:bg-gray-800 transition-all text-left flex items-center gap-4"
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-medium truncate">{opinion.title}</h3>
              {opinion.opinionType && (
                <span className="px-2 py-0.5 bg-blue-500/20 text-blue-400 text-xs rounded-full shrink-0">
                  {opinion.opinionType}
                </span>
              )}
              {opinion.isActive ? (
                <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 text-xs rounded-full shrink-0">
                  Active
                </span>
              ) : opinion.isFinalized ? (
                <span className="px-2 py-0.5 bg-gray-500/20 text-gray-400 text-xs rounded-full shrink-0">
                  Finalized
                </span>
              ) : (
                <span className="px-2 py-0.5 bg-yellow-500/20 text-yellow-400 text-xs rounded-full shrink-0">
                  Ended
                </span>
              )}
            </div>
            <p className="text-sm text-gray-500">
              by {opinion.authorNfd || truncateAddress(opinion.author, 4)} • App ID: {opinion.appId.toString()}
            </p>
          </div>
          <div className="text-right shrink-0">
            <div className="text-xl font-bold text-emerald-400">{opinion.signatureCount}</div>
            <div className="text-xs text-gray-500">signatures</div>
          </div>
        </button>
      ))}
    </div>
  )
}
