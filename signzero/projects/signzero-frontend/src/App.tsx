import { useState, useCallback } from 'react'
import { useWallet } from '@txnlab/use-wallet-react'
import { ConnectWallet } from './components/ConnectWallet'
import { CreatePetition } from './components/CreatePetition'
import { ViewPetition } from './components/ViewPetition'
import { PetitionList, savePetitionId } from './components/PetitionList'

const networkId = (import.meta.env.VITE_NETWORK || 'localnet') as 'localnet' | 'testnet' | 'mainnet'

type View = 'home' | 'create' | 'view'

function App() {
  const { activeAddress } = useWallet()
  const [view, setView] = useState<View>('home')
  const [viewAppId, setViewAppId] = useState<bigint | null>(null)
  const [listKey, setListKey] = useState(0)

  const handleViewPetition = (appId: bigint) => {
    setViewAppId(appId)
    setView('view')
  }

  const handlePetitionCreated = useCallback((appId: bigint) => {
    savePetitionId(appId)
    setListKey((k) => k + 1)
    handleViewPetition(appId)
  }, [])

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 via-gray-800 to-gray-900">
      {/* Header */}
      <header className="border-b border-gray-700 bg-gray-900/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <button
            onClick={() => setView('home')}
            className="flex items-center gap-3 hover:opacity-80 transition-opacity"
          >
            <div className="w-10 h-10 bg-gradient-to-br from-emerald-400 to-cyan-500 rounded-lg flex items-center justify-center">
              <span className="text-xl font-bold text-gray-900">0</span>
            </div>
            <span className="text-xl font-bold bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
              SignZero
            </span>
          </button>

          <div className="flex items-center gap-4">
            <span className="text-xs text-gray-500 uppercase tracking-wider">
              {networkId}
            </span>
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
              <h1 className="text-3xl md:text-4xl font-bold mb-2">
                <span className="bg-gradient-to-r from-emerald-400 via-cyan-400 to-blue-400 bg-clip-text text-transparent">
                  Decentralized Petitions
                </span>
              </h1>
              <p className="text-gray-400 max-w-xl mx-auto">
                Create and sign petitions on the Algorand blockchain with permanent, transparent signatures.
              </p>
            </div>

            {/* Action Cards - Smaller */}
            <div className="grid grid-cols-2 gap-4 max-w-2xl mx-auto">
              <button
                onClick={() => setView('create')}
                disabled={!activeAddress}
                className="p-4 bg-gray-800/50 border border-gray-700 rounded-lg hover:border-emerald-500/50 hover:bg-gray-800 transition-all group disabled:opacity-50 disabled:cursor-not-allowed text-left"
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">📝</span>
                  <div>
                    <h3 className="font-semibold group-hover:text-emerald-400 transition-colors">
                      Create Petition
                    </h3>
                    <p className="text-gray-500 text-xs">
                      {activeAddress ? 'Start a new petition' : 'Connect wallet first'}
                    </p>
                  </div>
                </div>
              </button>

              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  const formData = new FormData(e.currentTarget)
                  const appId = formData.get('appId') as string
                  if (appId) {
                    handleViewPetition(BigInt(appId))
                  }
                }}
                className="p-4 bg-gray-800/50 border border-gray-700 rounded-lg"
              >
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-2xl">🔍</span>
                  <h3 className="font-semibold">View by ID</h3>
                </div>
                <div className="flex gap-2">
                  <input
                    type="number"
                    name="appId"
                    placeholder="App ID"
                    className="flex-1 px-2 py-1.5 text-sm bg-gray-900 border border-gray-600 rounded focus:outline-none focus:border-cyan-500"
                  />
                  <button
                    type="submit"
                    className="px-3 py-1.5 text-sm bg-cyan-600 hover:bg-cyan-500 rounded transition-colors"
                  >
                    Go
                  </button>
                </div>
              </form>
            </div>

            {/* Petition List */}
            <div className="max-w-2xl mx-auto">
              <h2 className="text-lg font-semibold mb-4 text-gray-300">Recent Petitions</h2>
              <PetitionList
                key={listKey}
                networkId={networkId}
                onViewPetition={handleViewPetition}
              />
            </div>

            {/* Info - Collapsible */}
            <details className="max-w-2xl mx-auto">
              <summary className="cursor-pointer text-gray-500 hover:text-gray-400 text-sm">
                How it works
              </summary>
              <div className="mt-3 p-4 bg-gray-800/30 border border-gray-700 rounded-lg">
                <ol className="space-y-2 text-gray-400 text-sm">
                  <li>
                    <span className="text-emerald-400 font-medium">1.</span> Connect your
                    Algorand wallet (Pera, Defly, or KMD for LocalNet)
                  </li>
                  <li>
                    <span className="text-emerald-400 font-medium">2.</span> Create a petition
                    with a title, description, and duration (requires 20 ALGO funding)
                  </li>
                  <li>
                    <span className="text-emerald-400 font-medium">3.</span> Share the App ID
                    with others to collect signatures
                  </li>
                  <li>
                    <span className="text-emerald-400 font-medium">4.</span> Signers opt into
                    the petition's ASA to record their support permanently
                  </li>
                  <li>
                    <span className="text-emerald-400 font-medium">5.</span> After the petition
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
              className="mb-6 text-gray-400 hover:text-white flex items-center gap-2"
            >
              ← Back
            </button>
            <CreatePetition
              networkId={networkId}
              onCreated={handlePetitionCreated}
            />
          </div>
        )}

        {view === 'view' && viewAppId && (
          <div>
            <button
              onClick={() => setView('home')}
              className="mb-6 text-gray-400 hover:text-white flex items-center gap-2"
            >
              ← Back
            </button>
            <ViewPetition appId={viewAppId} networkId={networkId} />
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-800 py-6 mt-12">
        <div className="max-w-6xl mx-auto px-4 text-center text-gray-500 text-sm">
          Built on Algorand • Powered by AlgoKit
        </div>
      </footer>
    </div>
  )
}

export default App
