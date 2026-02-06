import { useState } from 'react'
import { useWallet } from '@txnlab/use-wallet-react'
import { getAlgorandClient } from '../utils/algorand'
import type { NetworkId } from '../utils/algorand'
import { SignZeroFactory } from '../contracts/SignZeroClient'
import { microAlgo } from '@algorandfoundation/algokit-utils'

interface CreatePetitionProps {
  networkId: NetworkId
  onCreated: (appId: bigint) => void
}

export function CreatePetition({ networkId, onCreated }: CreatePetitionProps) {
  const { activeAddress, transactionSigner } = useWallet()
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [durationDays, setDurationDays] = useState(7)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeAddress || !transactionSigner) return

    setLoading(true)
    setError(null)

    try {
      const algorand = getAlgorandClient(networkId)

      // Register the wallet signer
      algorand.setSigner(activeAddress, transactionSigner)

      const factory = algorand.client.getTypedAppFactory(SignZeroFactory, {
        defaultSender: activeAddress,
      })

      // Create the application
      const { appClient, result } = await factory.send.create.createApplication({
        args: {},
      })

      console.log('App created with ID:', result.appId)

      // Calculate duration in rounds (~3.3 seconds per round)
      const roundsPerDay = Math.floor((24 * 60 * 60) / 3.3)
      const duration = BigInt(durationDays * roundsPerDay)

      // Initialize the petition with funding
      const textBytes = new TextEncoder().encode(text)

      const initResult = await appClient
        .newGroup()
        .addTransaction(
          await algorand.createTransaction.payment({
            sender: activeAddress,
            receiver: appClient.appAddress,
            amount: (20).algo(),
          })
        )
        .initializePetition({
          args: {
            title,
            text: textBytes,
            duration,
          },
          extraFee: microAlgo(1000),
        })
        .send()

      const asaId = initResult.returns?.[0]
      console.log('Petition initialized with ASA ID:', asaId)

      onCreated(result.appId)
    } catch (err) {
      console.error('Error creating petition:', err)
      setError(err instanceof Error ? err.message : 'Failed to create petition')
    } finally {
      setLoading(false)
    }
  }

  if (!activeAddress) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-400">Please connect your wallet to create a petition.</p>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold mb-2">Create Petition</h1>
      <p className="text-gray-400 mb-8">
        Start a new petition. Requires 20 ALGO funding to cover contract costs.
      </p>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-sm font-medium mb-2">Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Enter petition title (max 32 characters)"
            maxLength={32}
            required
            className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:border-emerald-500"
          />
          <p className={`text-xs mt-1 ${32 - title.length <= 5 ? 'text-yellow-500' : 'text-gray-500'}`}>
            {32 - title.length} characters remaining
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Description</label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Describe what you're petitioning for..."
            rows={6}
            maxLength={2000}
            required
            className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:border-emerald-500 resize-none"
          />
          <p className={`text-xs mt-1 ${2000 - text.length <= 100 ? 'text-yellow-500' : 'text-gray-500'}`}>
            {2000 - text.length} characters remaining
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Duration (days)</label>
          <input
            type="number"
            value={durationDays}
            onChange={(e) => setDurationDays(Math.max(1, parseInt(e.target.value) || 1))}
            min={1}
            max={365}
            required
            className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:border-emerald-500"
          />
          <p className="text-xs text-gray-500 mt-1">
            Petition will be active for {durationDays} day{durationDays > 1 ? 's' : ''} (~
            {Math.floor((durationDays * 24 * 60 * 60) / 3.3).toLocaleString()} rounds)
          </p>
        </div>

        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
          <h3 className="font-medium mb-2">Cost Summary</h3>
          <div className="space-y-1 text-sm text-gray-400">
            <div className="flex justify-between">
              <span>Petition funding</span>
              <span>20 ALGO</span>
            </div>
            <div className="flex justify-between">
              <span>Transaction fees</span>
              <span>~0.003 ALGO</span>
            </div>
            <div className="flex justify-between pt-2 border-t border-gray-700 text-white">
              <span>Total</span>
              <span>~20.003 ALGO</span>
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 text-red-400">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !title || !text}
          className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-lg font-medium text-lg transition-colors"
        >
          {loading ? 'Creating Petition...' : 'Create Petition (20 ALGO)'}
        </button>
      </form>
    </div>
  )
}
