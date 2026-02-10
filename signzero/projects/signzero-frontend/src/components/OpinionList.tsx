import { useState, useEffect } from 'react'
import { getAlgorandClient } from '../utils/algorand'
import type { NetworkId } from '../utils/algorand'
import { truncateAddress, batchLookupNFD } from '../utils/nfd'
import { parseGlobalState, isSignZeroOpinion, decodeOpinionType } from '../utils/signzero'

// Fixed min-round for note prefix search per network (approximate chain start for SignZero)
const MIN_ROUND: Record<string, number> = {
  testnet: 60000000,
  mainnet: 58200000,
}

interface OpinionListProps {
  networkId: NetworkId
  onViewOpinion: (appId: bigint) => void
  authorFilter?: string | null
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

const PAGE_SIZES = [15, 30, 60] as const

export function OpinionList({ networkId, onViewOpinion, authorFilter }: OpinionListProps) {
  const [opinions, setOpinions] = useState<OpinionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState<number>(15)

  useEffect(() => {
    loadOpinions()
  }, [networkId])

  useEffect(() => {
    setPage(0)
  }, [pageSize, authorFilter])

  // Localnet: full indexer scan (few apps, no rate limits)
  const scanAllApps = async () => {
    const algorand = getAlgorandClient(networkId)
    const status = await algorand.client.algod.status().do()
    const currentRound = BigInt(status.lastRound)

    interface MatchedApp {
      appId: bigint
      finalized: boolean
      endRound: bigint
      asaId: bigint
    }
    const matched: MatchedApp[] = []
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

        const initialized = parsed.init === 1n
        if (!initialized) continue

        matched.push({
          appId: BigInt(app.id),
          finalized: parsed.finalized === 1n,
          endRound: parsed.end as bigint,
          asaId: parsed.asa as bigint,
        })
      }
    } while (nextToken)

    return { matched, currentRound }
  }

  // Discover SignZero apps via note prefix on creation transactions
  const discoverByNotePrefix = async (): Promise<bigint[]> => {
    const algorand = getAlgorandClient(networkId)
    const discovered: bigint[] = []
    const notePrefix = new TextEncoder().encode('signzero:v1')
    const minRound = MIN_ROUND[networkId] || 0

    let nextToken: string | undefined
    const MAX_PAGES = 10

    for (let i = 0; i < MAX_PAGES; i++) {
      const search = algorand.client.indexer
        .searchForTransactions()
        .txType('appl')
        .notePrefix(notePrefix)
        .minRound(minRound)
        .limit(100)

      if (nextToken) {
        search.nextToken(nextToken)
      }

      const response = await search.do()
      const txns = response.transactions || []
      nextToken = response.nextToken

      for (const txn of txns) {
        if (txn.createdApplicationIndex) {
          discovered.push(BigInt(txn.createdApplicationIndex))
        }
      }

      if (!nextToken) break
    }

    return discovered
  }

  // Testnet/mainnet: discover apps via note prefix search
  const loadDiscoveredApps = async () => {
    const algorand = getAlgorandClient(networkId)
    const status = await algorand.client.algod.status().do()
    const currentRound = BigInt(status.lastRound)

    const appIds = await discoverByNotePrefix()

    interface MatchedApp {
      appId: bigint
      finalized: boolean
      endRound: bigint
      asaId: bigint
    }
    const matched: MatchedApp[] = []

    for (const appId of appIds) {
      try {
        const appInfo = await algorand.client.algod.getApplicationByID(Number(appId)).do()
        const globalState = appInfo.params?.globalState
        if (!globalState) continue

        const parsed = parseGlobalState(globalState)
        if (!isSignZeroOpinion(parsed)) continue

        const initialized = parsed.init === 1n
        if (!initialized) continue

        matched.push({
          appId,
          finalized: parsed.finalized === 1n,
          endRound: parsed.end as bigint,
          asaId: parsed.asa as bigint,
        })
      } catch {
        // App may have been deleted
      }
    }

    return { matched, currentRound }
  }

  const loadOpinions = async () => {
    setLoading(true)
    setError(null)

    try {
      const algorand = getAlgorandClient(networkId)

      const { matched, currentRound } =
        networkId === 'localnet' ? await scanAllApps() : await loadDiscoveredApps()

      matched.sort((a, b) => (b.appId > a.appId ? 1 : -1))

      const loaded: OpinionSummary[] = []

      for (const app of matched) {
        try {
          const assetInfo = await algorand.client.algod.getAssetByID(Number(app.asaId)).do()
          const title = assetInfo.params.name || 'Untitled'
          const author = assetInfo.params.reserve || ''
          const opinionType = decodeOpinionType(assetInfo.params.metadataHash)

          let signatureCount = 0
          try {
            const balances = await algorand.client.indexer
              .lookupAssetBalances(Number(app.asaId))
              .do()
            signatureCount = balances.balances?.length || 0
          } catch {
            // Indexer balance lookup might fail
          }

          loaded.push({
            appId: app.appId,
            title,
            opinionType,
            author,
            authorNfd: null,
            signatureCount,
            isActive: currentRound <= app.endRound && !app.finalized,
            isFinalized: app.finalized,
          })
        } catch (err) {
          console.error(`Failed to load ASA info for opinion ${app.appId}:`, err)
        }
      }

      if (loaded.length > 0 && networkId !== 'localnet') {
        const authors = [...new Set(loaded.map((p) => p.author).filter(Boolean))]
        const nfdResults = await batchLookupNFD(authors)

        for (const opinion of loaded) {
          if (opinion.author && nfdResults[opinion.author]) {
            opinion.authorNfd = nfdResults[opinion.author].name
          }
        }
      }

      setOpinions(loaded)
      setPage(0)
    } catch (err) {
      console.error('Failed to load opinions:', err)
      setError(
        networkId === 'localnet'
          ? 'Failed to load opinions. Indexer may not be available.'
          : 'Failed to load opinions.'
      )
    } finally {
      setLoading(false)
    }
  }

  // Apply author filter
  const filtered = authorFilter
    ? opinions.filter((o) => o.author.toLowerCase() === authorFilter.toLowerCase())
    : opinions

  if (loading) {
    return (
      <div className="text-center py-8">
        <div className="animate-spin w-6 h-6 border-2 border-[var(--accent-green)] border-t-transparent mx-auto mb-2" />
        <p className="text-[var(--text-secondary)] text-sm">Loading opinions...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-8 bg-[var(--bg-surface)] border border-[var(--accent-red)]">
        <p className="text-[var(--accent-red)] text-sm">{error}</p>
        <button
          onClick={loadOpinions}
          className="mt-2 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] underline"
        >
          Try again
        </button>
      </div>
    )
  }

  if (filtered.length === 0) {
    return (
      <div className="text-center py-12 bg-[var(--bg-card)] border border-[var(--border)]">
        <p className="text-[var(--text-secondary)]">
          {authorFilter
            ? 'No opinions found by this author.'
            : networkId === 'localnet'
              ? 'No opinions found on the blockchain yet.'
              : 'No opinions discovered yet. Create one or use Find Opinion to look up by App ID, ASA ID, or Author.'}
        </p>
        {!authorFilter && networkId === 'localnet' && (
          <p className="text-[var(--text-muted)] text-sm mt-1">Create one to get started!</p>
        )}
      </div>
    )
  }

  const totalPages = Math.ceil(filtered.length / pageSize)
  const pageOpinions = filtered.slice(page * pageSize, (page + 1) * pageSize)

  return (
    <div className="space-y-3">
      {pageOpinions.map((opinion) => (
        <button
          key={opinion.appId.toString()}
          onClick={() => onViewOpinion(opinion.appId)}
          className="w-full p-4 bg-[var(--bg-card)] border border-[var(--border)] hover:border-[var(--accent-green)] hover:bg-[var(--bg-surface)] transition-all text-left flex items-center gap-4"
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-medium truncate">{opinion.title}</h3>
              {opinion.opinionType && (
                <span className="px-2 py-0.5 border border-[var(--accent-blue)] text-[var(--accent-blue)] text-xs shrink-0">
                  {opinion.opinionType}
                </span>
              )}
              {opinion.isActive ? (
                <span className="px-2 py-0.5 border border-[var(--accent-green)] text-[var(--accent-green)] text-xs shrink-0">
                  Active
                </span>
              ) : opinion.isFinalized ? (
                <span className="px-2 py-0.5 border border-[var(--text-secondary)] text-[var(--text-secondary)] text-xs shrink-0">
                  Finalized
                </span>
              ) : (
                <span className="px-2 py-0.5 border border-[var(--accent-yellow)] text-[var(--accent-yellow)] text-xs shrink-0">
                  Ended
                </span>
              )}
            </div>
            <p className="text-sm text-[var(--text-secondary)]">
              by {opinion.authorNfd || truncateAddress(opinion.author, 4)} | App ID: {opinion.appId.toString()}
            </p>
          </div>
          <div className="text-right shrink-0">
            <div className="text-xl font-bold text-[var(--accent-green)]">{opinion.signatureCount}</div>
            <div className="text-xs text-[var(--text-secondary)]">signatures</div>
          </div>
        </button>
      ))}

      {/* Pagination */}
      <div className="flex items-center justify-between pt-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--text-secondary)]">Show</span>
          {PAGE_SIZES.map((size) => (
            <button
              key={size}
              onClick={() => setPageSize(size)}
              className={`px-2 py-1 text-xs transition-colors border ${
                pageSize === size
                  ? 'bg-[var(--bg-accent)] text-[var(--text-inverse)] border-[var(--bg-accent)]'
                  : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border-[var(--border)]'
              }`}
            >
              {size}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--text-secondary)]">
            {page * pageSize + 1}-{Math.min((page + 1) * pageSize, filtered.length)} of {filtered.length}
          </span>
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-2 py-1 text-xs bg-[var(--bg-surface)] border border-[var(--border)] disabled:opacity-30 hover:text-[var(--text-primary)] text-[var(--text-secondary)] transition-colors"
          >
            Prev
          </button>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="px-2 py-1 text-xs bg-[var(--bg-surface)] border border-[var(--border)] disabled:opacity-30 hover:text-[var(--text-primary)] text-[var(--text-secondary)] transition-colors"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  )
}
