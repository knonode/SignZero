import { useState } from 'react'
import { useWallet } from '@txnlab/use-wallet-react'
import { getAlgorandClient } from '../utils/algorand'
import type { NetworkId } from '../utils/algorand'
import { SignZeroFactory } from '../contracts/SignZeroClient'
import { useToast } from './Toast'
import { microAlgo } from '@algorandfoundation/algokit-utils'
import { GATE_ASA_HOLD, GATE_ASA_DENY, GATE_BAL_MIN, GATE_BAL_MAX, GATE_ONLINE, GATE_AGE, GATE_NFD, packUint64Array } from '../utils/gates'

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
  'Essay',
  'Thesis',
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

  // Gate config state
  const [gatesOpen, setGatesOpen] = useState(false)
  const [gateAsaHold, setGateAsaHold] = useState(false)
  const [asaHoldIds, setAsaHoldIds] = useState<string[]>([''])
  const [gateAsaDeny, setGateAsaDeny] = useState(false)
  const [asaDenyIds, setAsaDenyIds] = useState<string[]>([''])
  const [gateBalMin, setGateBalMin] = useState(false)
  const [balMinAlgo, setBalMinAlgo] = useState('')
  const [gateBalMax, setGateBalMax] = useState(false)
  const [balMaxAlgo, setBalMaxAlgo] = useState('')
  const [gateOnline, setGateOnline] = useState(false)
  const [gateAge, setGateAge] = useState(false)
  const [minAgeDays, setMinAgeDays] = useState('')
  const [gateNfd, setGateNfd] = useState(false)
  const [nfdRoot, setNfdRoot] = useState('')

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

      // Set gates if any are enabled
      const flags = (gateAsaHold ? GATE_ASA_HOLD : 0)
        | (gateAsaDeny ? GATE_ASA_DENY : 0)
        | (gateBalMin ? GATE_BAL_MIN : 0)
        | (gateBalMax ? GATE_BAL_MAX : 0)
        | (gateOnline ? GATE_ONLINE : 0)
        | (gateAge ? GATE_AGE : 0)
        | (gateNfd ? GATE_NFD : 0)

      if (flags > 0) {
        updateToast(toastId, 'Setting signer requirements...', 'loading')

        const holdIds = gateAsaHold
          ? asaHoldIds.filter((id) => id.trim()).map((id) => BigInt(id.trim()))
          : []
        const denyIds = gateAsaDeny
          ? asaDenyIds.filter((id) => id.trim()).map((id) => BigInt(id.trim()))
          : []

        const roundsPerDay = Math.floor((24 * 60 * 60) / 3.3)

        await appClient.send.setGates({
          args: {
            flags: BigInt(flags),
            balMin: gateBalMin ? BigInt(Math.floor(parseFloat(balMinAlgo) * 1_000_000)) : 0n,
            balMax: gateBalMax ? BigInt(Math.floor(parseFloat(balMaxAlgo) * 1_000_000)) : 0n,
            minAge: gateAge ? BigInt(parseInt(minAgeDays) * roundsPerDay) : 0n,
            asaHold: packUint64Array(holdIds),
            asaDeny: packUint64Array(denyIds),
            nfdRoot: gateNfd ? nfdRoot.trim() : '',
          },
          boxReferences: [
            ...(gateAsaHold ? ['gate_hold'] : []),
            ...(gateAsaDeny ? ['gate_deny'] : []),
            ...(gateNfd ? ['gate_nfd'] : []),
          ],
        })
      }

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

        {/* Signer Requirements (Gates) */}
        <div className="border border-[var(--border)]">
          <button
            type="button"
            onClick={() => setGatesOpen(!gatesOpen)}
            className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-[var(--bg-surface)] transition-colors"
          >
            <span className="font-medium">Signer Requirements (Optional)</span>
            <span className="text-[var(--text-secondary)]">{gatesOpen ? '\u25B2' : '\u25BC'}</span>
          </button>

          {gatesOpen && (
            <div className="px-4 pb-4 space-y-4 border-t border-[var(--border)] pt-4">
              <p className="text-xs text-[var(--text-secondary)]">
                Restrict who can sign this opinion. Requirements are checked before signing. Once set, they cannot be changed.
              </p>

              {/* ASA Must Hold */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={gateAsaHold} onChange={(e) => setGateAsaHold(e.target.checked)} className="accent-[var(--accent-green)]" />
                  <span className="text-sm">Must hold ASA(s)</span>
                </label>
                {gateAsaHold && (
                  <div className="ml-6 space-y-2">
                    {asaHoldIds.map((id, i) => (
                      <div key={i} className="flex gap-2">
                        <input
                          type="text"
                          value={id}
                          onChange={(e) => { const next = [...asaHoldIds]; next[i] = e.target.value; setAsaHoldIds(next) }}
                          placeholder="ASA ID"
                          className="flex-1 px-3 py-2 text-sm bg-[var(--bg-surface)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent-green)]"
                        />
                        {asaHoldIds.length > 1 && (
                          <button type="button" onClick={() => setAsaHoldIds(asaHoldIds.filter((_, j) => j !== i))} className="px-2 text-[var(--accent-red)] hover:bg-[var(--bg-surface)]">x</button>
                        )}
                      </div>
                    ))}
                    <button type="button" onClick={() => setAsaHoldIds([...asaHoldIds, ''])} className="text-sm text-[var(--accent-cyan)] hover:underline">+ Add ASA</button>
                  </div>
                )}
              </div>

              {/* ASA Must NOT Hold */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={gateAsaDeny} onChange={(e) => setGateAsaDeny(e.target.checked)} className="accent-[var(--accent-green)]" />
                  <span className="text-sm">Must NOT hold ASA(s)</span>
                </label>
                {gateAsaDeny && (
                  <div className="ml-6 space-y-2">
                    {asaDenyIds.map((id, i) => (
                      <div key={i} className="flex gap-2">
                        <input
                          type="text"
                          value={id}
                          onChange={(e) => { const next = [...asaDenyIds]; next[i] = e.target.value; setAsaDenyIds(next) }}
                          placeholder="ASA ID"
                          className="flex-1 px-3 py-2 text-sm bg-[var(--bg-surface)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent-green)]"
                        />
                        {asaDenyIds.length > 1 && (
                          <button type="button" onClick={() => setAsaDenyIds(asaDenyIds.filter((_, j) => j !== i))} className="px-2 text-[var(--accent-red)] hover:bg-[var(--bg-surface)]">x</button>
                        )}
                      </div>
                    ))}
                    <button type="button" onClick={() => setAsaDenyIds([...asaDenyIds, ''])} className="text-sm text-[var(--accent-cyan)] hover:underline">+ Add ASA</button>
                  </div>
                )}
              </div>

              {/* NFD Segment */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={gateNfd} onChange={(e) => setGateNfd(e.target.checked)} className="accent-[var(--accent-green)]" />
                  <span className="text-sm">NFD segment required</span>
                </label>
                {gateNfd && (
                  <div className="ml-6">
                    <input
                      type="text"
                      value={nfdRoot}
                      onChange={(e) => setNfdRoot(e.target.value)}
                      placeholder="Root NFD (e.g. dao.algo)"
                      className="w-full px-3 py-2 text-sm bg-[var(--bg-surface)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent-green)]"
                    />
                  </div>
                )}
              </div>

              {/* Account Age */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={gateAge} onChange={(e) => setGateAge(e.target.checked)} className="accent-[var(--accent-green)]" />
                  <span className="text-sm">Minimum account age</span>
                </label>
                {gateAge && (
                  <div className="ml-6">
                    <input
                      type="number"
                      value={minAgeDays}
                      onChange={(e) => setMinAgeDays(e.target.value)}
                      placeholder="Days"
                      min={1}
                      className="w-full px-3 py-2 text-sm bg-[var(--bg-surface)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent-green)]"
                    />
                  </div>
                )}
              </div>

              {/* Online Validator */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={gateOnline} onChange={(e) => setGateOnline(e.target.checked)} className="accent-[var(--accent-green)]" />
                <span className="text-sm">Must be online validator (consensus participant)</span>
              </label>

              {/* ALGO Balance */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={gateBalMin} onChange={(e) => setGateBalMin(e.target.checked)} className="accent-[var(--accent-green)]" />
                  <span className="text-sm">Minimum ALGO balance</span>
                </label>
                {gateBalMin && (
                  <div className="ml-6">
                    <input
                      type="number"
                      value={balMinAlgo}
                      onChange={(e) => setBalMinAlgo(e.target.value)}
                      placeholder="ALGO"
                      min={0}
                      step="0.1"
                      className="w-full px-3 py-2 text-sm bg-[var(--bg-surface)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent-green)]"
                    />
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={gateBalMax} onChange={(e) => setGateBalMax(e.target.checked)} className="accent-[var(--accent-green)]" />
                  <span className="text-sm">Maximum ALGO balance</span>
                </label>
                {gateBalMax && (
                  <div className="ml-6">
                    <input
                      type="number"
                      value={balMaxAlgo}
                      onChange={(e) => setBalMaxAlgo(e.target.value)}
                      placeholder="ALGO"
                      min={0}
                      step="0.1"
                      className="w-full px-3 py-2 text-sm bg-[var(--bg-surface)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent-green)]"
                    />
                  </div>
                )}
              </div>
            </div>
          )}
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
