import { useState, useCallback } from 'react'
import { useWallet, useNetwork } from '@txnlab/use-wallet-react'
import { NetworkId as WalletNetworkId } from '@txnlab/use-wallet'
import { ConnectWallet } from './components/ConnectWallet'
import { CreateOpinion } from './components/CreateOpinion'
import { ViewOpinion } from './components/ViewOpinion'
import { OpinionList } from './components/OpinionList'
import { useTheme } from './ThemeContext'
import { resolveAsaToAppId } from './utils/signzero'
import { resolveNFDName, truncateAddress } from './utils/nfd'
import type { NetworkId } from './utils/algorand'

const NETWORKS: NetworkId[] = ['localnet', 'testnet', 'mainnet']

function toWalletNetworkId(id: NetworkId): WalletNetworkId {
  switch (id) {
    case 'testnet':
      return WalletNetworkId.TESTNET
    case 'mainnet':
      return WalletNetworkId.MAINNET
    default:
      return WalletNetworkId.LOCALNET
  }
}

type View = 'home' | 'create' | 'view'
type LookupMode = 'appId' | 'asaId' | 'author'

const LOOKUP_MODES: { mode: LookupMode; label: string }[] = [
  { mode: 'appId', label: 'App ID' },
  { mode: 'asaId', label: 'ASA ID' },
  { mode: 'author', label: 'Author' },
]

function App() {
  const { activeAddress, activeWallet } = useWallet()
  const { setActiveNetwork } = useNetwork()
  const { theme, toggleTheme } = useTheme()
  const [networkId, setNetworkId] = useState<NetworkId>(
    (import.meta.env.VITE_NETWORK || 'localnet') as NetworkId
  )
  const [view, setView] = useState<View>('home')
  const [viewAppId, setViewAppId] = useState<bigint | null>(null)
  const [listKey, setListKey] = useState(0)

  // Lookup state
  const [lookupMode, setLookupMode] = useState<LookupMode>('appId')
  const [lookupValue, setLookupValue] = useState('')
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [resolving, setResolving] = useState(false)
  const [authorFilter, setAuthorFilter] = useState<string | null>(null)
  const [authorFilterLabel, setAuthorFilterLabel] = useState<string | null>(null)

  const handleNetworkChange = async (network: NetworkId) => {
    if (network === networkId) return
    if (activeWallet) {
      await activeWallet.disconnect()
    }
    setActiveNetwork(toWalletNetworkId(network))
    setNetworkId(network)
    setView('home')
    setListKey((k) => k + 1)
    clearAuthorFilter()
  }

  const handleViewOpinion = (appId: bigint) => {
    setViewAppId(appId)
    setView('view')
  }

  const handleOpinionCreated = useCallback((appId: bigint) => {
    setListKey((k) => k + 1)
    handleViewOpinion(appId)
  }, [])

  const clearAuthorFilter = () => {
    setAuthorFilter(null)
    setAuthorFilterLabel(null)
  }

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault()
    const val = lookupValue.trim()
    if (!val) return
    setLookupError(null)

    if (lookupMode === 'appId') {
      try {
        handleViewOpinion(BigInt(val))
      } catch {
        setLookupError('Invalid App ID')
      }
      return
    }

    if (lookupMode === 'asaId') {
      setResolving(true)
      try {
        const appId = await resolveAsaToAppId(BigInt(val), networkId)
        if (appId) {
          handleViewOpinion(appId)
        } else {
          setLookupError('No SignZero opinion found with this ASA ID')
        }
      } catch {
        setLookupError('Failed to look up ASA ID')
      } finally {
        setResolving(false)
      }
      return
    }

    if (lookupMode === 'author') {
      setResolving(true)
      try {
        let address = val
        let label = val
        // Check if it looks like an NFD name
        if (val.includes('.')) {
          const resolved = await resolveNFDName(val)
          if (!resolved) {
            setLookupError('NFD name not found')
            setResolving(false)
            return
          }
          address = resolved
          label = `${val} (${truncateAddress(resolved, 4)})`
        } else if (val.length !== 58) {
          setLookupError('Enter a valid Algorand address or NFD name')
          setResolving(false)
          return
        }
        setAuthorFilter(address)
        setAuthorFilterLabel(label)
        setListKey((k) => k + 1)
      } catch {
        setLookupError('Failed to resolve address')
      } finally {
        setResolving(false)
      }
      return
    }
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-[var(--border)] bg-[var(--bg-header)] backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <button
            onClick={() => setView('home')}
            className="flex items-center gap-3 hover:opacity-80 transition-opacity"
          >
            <img src="/android-chrome-192x192.png" alt="SignZero" className="w-10 h-10" />
            <span className="text-xl font-bold text-[var(--text-primary)]">
              SignZero
            </span>
          </button>

          <div className="flex items-center gap-4">
            {/* Theme Toggle */}
            <button
              onClick={toggleTheme}
              className="w-9 h-9 flex items-center justify-center border border-[var(--border)] hover:border-[var(--accent-green)] transition-colors"
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            >
              {theme === 'dark' ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="5" />
                  <line x1="12" y1="1" x2="12" y2="3" />
                  <line x1="12" y1="21" x2="12" y2="23" />
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                  <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                  <line x1="1" y1="12" x2="3" y2="12" />
                  <line x1="21" y1="12" x2="23" y2="12" />
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                  <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              )}
            </button>

            {/* Network Toggle */}
            <div className="flex border border-[var(--border)]">
              {NETWORKS.map((net) => (
                <button
                  key={net}
                  onClick={() => handleNetworkChange(net)}
                  className={`px-3 py-1.5 text-xs uppercase tracking-wider transition-colors ${
                    networkId === net
                      ? 'bg-[var(--bg-accent)] text-[var(--text-inverse)] font-bold'
                      : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {net}
                </button>
              ))}
            </div>
            <ConnectWallet />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 py-8">
        {view === 'home' && (
          <div className="space-y-6">
            {/* Hero */}
            <div className="text-center py-6">
              <h1 className="text-3xl md:text-4xl font-bold mb-2 text-[var(--text-primary)]">
                Decentralized Opinions
              </h1>
              <p className="text-[var(--text-secondary)] max-w-xl mx-auto">
                Create and sign petitions, manifestos, declarations, and more on the Algorand blockchain with permanent, transparent signatures.
              </p>
            </div>

            {/* Action Cards */}
            <div className="grid grid-cols-2 gap-4 max-w-2xl mx-auto">
              <button
                onClick={() => setView('create')}
                disabled={!activeAddress}
                className="p-4 bg-[var(--bg-card)] border border-[var(--border)] hover:border-[var(--accent-green)] hover:bg-[var(--bg-surface)] transition-all group disabled:opacity-50 disabled:cursor-not-allowed text-left"
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">+</span>
                  <div>
                    <h3 className="font-semibold group-hover:text-[var(--accent-green)] transition-colors">
                      Create Opinion
                    </h3>
                    <p className="text-[var(--text-secondary)] text-xs">
                      {activeAddress ? 'Start a new opinion' : 'Connect wallet first'}
                    </p>
                  </div>
                </div>
              </button>

              {/* Find Opinion */}
              <form
                onSubmit={handleLookup}
                className="p-4 bg-[var(--bg-card)] border border-[var(--border)]"
              >
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-2xl">&gt;</span>
                  <h3 className="font-semibold">Find Opinion</h3>
                </div>
                <div className="flex gap-1 mb-2">
                  {LOOKUP_MODES.map(({ mode, label }) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => {
                        setLookupMode(mode)
                        setLookupError(null)
                        setLookupValue('')
                      }}
                      className={`px-2 py-0.5 text-xs transition-colors border ${
                        lookupMode === mode
                          ? 'bg-[var(--bg-accent)] text-[var(--text-inverse)] border-[var(--bg-accent)]'
                          : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border-[var(--border)]'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type={lookupMode === 'author' ? 'text' : 'number'}
                    value={lookupValue}
                    onChange={(e) => setLookupValue(e.target.value)}
                    placeholder={
                      lookupMode === 'appId'
                        ? 'App ID'
                        : lookupMode === 'asaId'
                          ? 'ASA ID'
                          : 'Address or name.algo'
                    }
                    className="flex-1 px-2 py-1.5 text-sm bg-[var(--bg-surface)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent-cyan)] min-w-0"
                  />
                  <button
                    type="submit"
                    disabled={resolving || !lookupValue.trim()}
                    className="px-3 py-1.5 text-sm bg-[var(--bg-accent)] text-[var(--text-inverse)] hover:bg-[var(--accent-cyan)] transition-colors disabled:opacity-50"
                  >
                    {resolving ? '...' : 'Go'}
                  </button>
                </div>
                {lookupError && (
                  <p className="text-xs text-[var(--accent-red)] mt-1.5">{lookupError}</p>
                )}
              </form>
            </div>

            {/* Opinion List */}
            <div className="max-w-2xl mx-auto">
              {/* Author filter banner */}
              {authorFilter && (
                <div className="flex items-center justify-between bg-[var(--bg-card)] border border-[var(--accent-blue)] px-4 py-2 mb-4">
                  <span className="text-sm">
                    Filtered by author:{' '}
                    <span className="text-[var(--accent-blue)] font-medium">{authorFilterLabel}</span>
                  </span>
                  <button
                    onClick={clearAuthorFilter}
                    className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] ml-4"
                  >
                    Clear
                  </button>
                </div>
              )}
              <h2 className="text-lg font-semibold mb-4 text-[var(--text-secondary)]">
                {authorFilter ? 'Opinions by Author' : 'Recent Opinions'}
              </h2>
              <OpinionList
                key={listKey}
                networkId={networkId}
                onViewOpinion={handleViewOpinion}
                authorFilter={authorFilter}
              />
            </div>

            {/* Info - Collapsible */}
            <details className="max-w-2xl mx-auto">
              <summary className="cursor-pointer text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-sm">
                How it works
              </summary>
              <div className="mt-3 p-4 bg-[var(--bg-card)] border border-[var(--border)]">
                <ol className="space-y-2 text-[var(--text-secondary)] text-sm">
                  <li>
                    <span className="text-[var(--accent-green)] font-medium">1.</span> Connect your
                    Algorand wallet (Pera, Defly, or KMD for LocalNet)
                  </li>
                  <li>
                    <span className="text-[var(--accent-green)] font-medium">2.</span> Create an opinion
                    — choose a type (petition, manifesto, declaration, etc.), add a title, description, and duration (requires 20 ALGO funding)
                  </li>
                  <li>
                    <span className="text-[var(--accent-green)] font-medium">3.</span> Share the App ID
                    with others to collect signatures
                  </li>
                  <li>
                    <span className="text-[var(--accent-green)] font-medium">4.</span> Signers opt into
                    the opinion's ASA to record their support permanently
                  </li>
                  <li>
                    <span className="text-[var(--accent-green)] font-medium">5.</span> After the opinion
                    ends, anyone can finalize it and claim the remaining balance
                  </li>
                </ol>
              </div>
            </details>
          </div>
        )}

        {view === 'create' && (
          <div>
            <button
              onClick={() => setView('home')}
              className="mb-6 text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center gap-2"
            >
              &lt;- Back
            </button>
            <CreateOpinion
              networkId={networkId}
              onCreated={handleOpinionCreated}
            />
          </div>
        )}

        {view === 'view' && viewAppId && (
          <div>
            <button
              onClick={() => setView('home')}
              className="mb-6 text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center gap-2"
            >
              &lt;- Back
            </button>
            <ViewOpinion appId={viewAppId} networkId={networkId} />
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-[var(--border)] py-6 mt-12">
        <div className="max-w-6xl mx-auto px-4 text-center text-[var(--text-secondary)] text-sm">
          Built on Algorand
        </div>
      </footer>
    </div>
  )
}

export default App
