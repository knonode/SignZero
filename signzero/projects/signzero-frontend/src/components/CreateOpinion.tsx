import { useState } from 'react'
import { useWallet } from '@txnlab/use-wallet-react'
import { getAlgorandClient } from '../utils/algorand'
import type { NetworkId } from '../utils/algorand'
import { SignZeroFactory } from '../contracts/SignZeroClient'
import { useToast } from './Toast'
import { microAlgo } from '@algorandfoundation/algokit-utils'

const encoder = new TextEncoder()
const byteLength = (s: string) => encoder.encode(s).byteLength

const OPINION_TYPES = [
  'Petition',
  'Manifesto',
  'Resolution',
  'Proposition',
  'Declaration',
  'Initiative',
  'Pledge',
  'Statement',
  'Charter',
  'Consensus',
  'Other',
] as const

interface CreateOpinionProps {
  networkId: NetworkId
  onCreated: (appId: bigint) => void
}

export function CreateOpinion({ networkId, onCreated }: CreateOpinionProps) {
  const { activeAddress, transactionSigner } = useWallet()
  const { addToast, updateToast } = useToast()
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [durationDays, setDurationDays] = useState(7)
  const [selectedType, setSelectedType] = useState<string>('Petition')
  const [customType, setCustomType] = useState('')
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const opinionTypeName = selectedType === 'Other' ? customType : selectedType

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeAddress || !transactionSigner) return

    if (!opinionTypeName.trim()) {
      setError('Opinion type cannot be empty')
      return
    }

    setLoading(true)
    setError(null)

    const toastId = addToast('Step 1/2: Approve app creation in your wallet (~0.001A fee)', 'loading')

    try {
      const algorand = getAlgorandClient(networkId)

      // Register the wallet signer
      algorand.setSigner(activeAddress, transactionSigner)

      const factory = algorand.client.getTypedAppFactory(SignZeroFactory, {
        defaultSender: activeAddress,
      })

      // Create the application with a note prefix for indexer discovery
      const { appClient, result } = await factory.send.create.createApplication({
        args: {},
        note: 'signzero:v1',
      })

      console.log('App created with ID:', result.appId)

      // Calculate duration in rounds (~3.3 seconds per round)
      const roundsPerDay = Math.floor((24 * 60 * 60) / 3.3)
      const duration = BigInt(durationDays * roundsPerDay)

      // Encode opinion type to 32-byte Uint8Array (right-padded with zeros)
      const opinionType = new Uint8Array(32)
      new TextEncoder().encodeInto(opinionTypeName.trim(), opinionType)

      // Encode text and split into ~2000-byte chunks
      const textBytes = new TextEncoder().encode(text)
      const CHUNK_SIZE = 2000
      const chunks: { offset: number; data: Uint8Array }[] = []
      for (let i = 0; i < textBytes.length; i += CHUNK_SIZE) {
        chunks.push({
          offset: i,
          data: textBytes.slice(i, i + CHUNK_SIZE),
        })
      }

      const numChunks = chunks.length
      const totalTxns = 2 + numChunks // payment + initialize + N writeChunks
      const feeEstimate = (0.001 * (totalTxns + 1)).toFixed(3) // +1 for inner txn
      updateToast(toastId, `Step 2/2: Approve funding (20 ALGO) + ${numChunks} chunk write${numChunks > 1 ? 's' : ''} (~${feeEstimate}A fees)`, 'loading')

      // Build atomic group: payment + initialize + writeChunk(s)
      let group = appClient
        .newGroup()
        .addTransaction(
          await algorand.createTransaction.payment({
            sender: activeAddress,
            receiver: appClient.appAddress,
            amount: (20).algo(),
          })
        )
        .initialize({
          args: {
            title,
            textSize: BigInt(textBytes.length),
            duration,
            opinionType,
            url,
          },
          extraFee: microAlgo(1000),
        })

      // Append writeChunk calls for each chunk
      for (const chunk of chunks) {
        group = group.writeChunk({
          args: {
            offset: BigInt(chunk.offset),
            data: chunk.data,
          },
        })
      }

      const initResult = await group.send()

      const asaId = initResult.returns?.[0]
      console.log('Opinion initialized with ASA ID:', asaId)

      updateToast(toastId, 'Opinion created successfully!', 'success')
      onCreated(result.appId)
    } catch (err) {
      console.error('Error creating opinion:', err)
      const msg = err instanceof Error ? err.message : 'Failed to create opinion'
      updateToast(toastId, msg, 'error')
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  if (!activeAddress) {
    return (
      <div className="text-center py-12">
        <p className="text-[var(--text-secondary)]">Please connect your wallet to create an opinion.</p>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold mb-2">Create Opinion</h1>
      <p className="text-[var(--text-secondary)] mb-8">
        Start a new opinion. Requires 20 ALGO funding to cover contract costs.
      </p>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-sm font-medium mb-2">Opinion Type</label>
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="w-full px-4 py-3 bg-[var(--bg-surface)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent-green)]"
          >
            {OPINION_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          {selectedType === 'Other' && (
            <input
              type="text"
              value={customType}
              onChange={(e) => {
                if (byteLength(e.target.value) <= 32) setCustomType(e.target.value)
              }}
              placeholder="Enter custom type (max 32 bytes)"
              required
              className="w-full mt-2 px-4 py-3 bg-[var(--bg-surface)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent-green)]"
            />
          )}
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => {
              if (byteLength(e.target.value) <= 32) setTitle(e.target.value)
            }}
            placeholder="Enter title (max 32 bytes)"
            required
            className="w-full px-4 py-3 bg-[var(--bg-surface)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent-green)]"
          />
          <p className={`text-xs mt-1 ${32 - byteLength(title) <= 5 ? 'text-[var(--accent-yellow)]' : 'text-[var(--text-secondary)]'}`}>
            {32 - byteLength(title)} bytes remaining
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Description</label>
          <textarea
            value={text}
            onChange={(e) => {
              if (byteLength(e.target.value) <= 32768) setText(e.target.value)
            }}
            placeholder="Describe your opinion..."
            rows={6}
            required
            className="w-full px-4 py-3 bg-[var(--bg-surface)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent-green)] resize-none"
          />
          <p className={`text-xs mt-1 ${32768 - byteLength(text) <= 500 ? 'text-[var(--accent-yellow)]' : 'text-[var(--text-secondary)]'}`}>
            {(32768 - byteLength(text)).toLocaleString()} bytes remaining
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">URL (optional)</label>
          <input
            type="url"
            value={url}
            onChange={(e) => {
              if (byteLength(e.target.value) <= 96) setUrl(e.target.value)
            }}
            placeholder="https://your-website.com"
            className="w-full px-4 py-3 bg-[var(--bg-surface)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent-green)]"
          />
          <p className={`text-xs mt-1 ${96 - byteLength(url) <= 10 ? 'text-[var(--accent-yellow)]' : 'text-[var(--text-secondary)]'}`}>
            Optional link ({96 - byteLength(url)} bytes remaining)
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
            className="w-full px-4 py-3 bg-[var(--bg-surface)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent-green)]"
          />
          <p className="text-xs text-[var(--text-secondary)] mt-1">
            Opinion will be active for {durationDays} day{durationDays > 1 ? 's' : ''} (~
            {Math.floor((durationDays * 24 * 60 * 60) / 3.3).toLocaleString()} rounds)
          </p>
        </div>

        <div className="bg-[var(--bg-card)] border border-[var(--border)] p-4">
          <h3 className="font-medium mb-2">Cost Summary</h3>
          <div className="space-y-1 text-sm text-[var(--text-secondary)]">
            <div className="flex justify-between">
              <span>Opinion funding</span>
              <span>20 ALGO</span>
            </div>
            <div className="flex justify-between">
              <span>Transaction fees ({Math.ceil(byteLength(text) / 2000) || 1} chunk{Math.ceil(byteLength(text) / 2000) > 1 ? 's' : ''})</span>
              <span>~{(0.003 + Math.ceil(byteLength(text) / 2000) * 0.001).toFixed(3)} ALGO</span>
            </div>
            <div className="flex justify-between pt-2 border-t border-[var(--border)] text-[var(--text-primary)]">
              <span>Total</span>
              <span>~{(20.003 + Math.ceil(byteLength(text) / 2000) * 0.001).toFixed(3)} ALGO</span>
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-[var(--bg-surface)] border border-[var(--accent-red)] p-4 text-[var(--accent-red)]">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !title || !text || byteLength(title) > 32 || byteLength(text) > 32768 || (selectedType === 'Other' && !customType.trim())}
          className="w-full py-4 bg-[var(--bg-accent)] text-[var(--text-inverse)] hover:bg-[var(--accent-green)] disabled:bg-[var(--bg-disabled)] disabled:text-[var(--text-secondary)] disabled:cursor-not-allowed font-medium text-lg transition-colors"
        >
          {loading ? 'Creating Opinion...' : 'Create Opinion (20 ALGO)'}
        </button>
      </form>
    </div>
  )
}
