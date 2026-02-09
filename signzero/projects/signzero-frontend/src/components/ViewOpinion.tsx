import { useState, useEffect } from 'react'
import { useWallet } from '@txnlab/use-wallet-react'
import { getAlgorandClient } from '../utils/algorand'
import type { NetworkId } from '../utils/algorand'
import { SignZeroClient } from '../contracts/SignZeroClient'
import { lookupNFD, truncateAddress } from '../utils/nfd'
import { microAlgo } from '@algorandfoundation/algokit-utils'

interface ViewOpinionProps {
  appId: bigint
  networkId: NetworkId
}

interface OpinionInfo {
  startRound: bigint
  endRound: bigint
  asaId: bigint
  finalized: boolean
  initialized: boolean
  title: string
  text: string
  opinionType: string
  url: string
  author: string
  authorNfd: string | null
  signatureCount: number
  currentRound: bigint
}

function decodeOpinionType(metadataHash: string | Uint8Array | undefined): string {
  if (!metadataHash) return ''
  let bytes: Uint8Array
  if (typeof metadataHash === 'string') {
    // base64 encoded
    const binary = atob(metadataHash)
    bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
  } else {
    bytes = metadataHash
  }
  // Strip trailing zero bytes
  let end = bytes.length
  while (end > 0 && bytes[end - 1] === 0) end--
  return new TextDecoder().decode(bytes.subarray(0, end))
}

export function ViewOpinion({ appId, networkId }: ViewOpinionProps) {
  const { activeAddress, transactionSigner } = useWallet()
  const [opinion, setOpinion] = useState<OpinionInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [signing, setSigning] = useState(false)
  const [finalizing, setFinalizing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasSigned, setHasSigned] = useState(false)

  const loadOpinion = async () => {
    setLoading(true)
    setError(null)

    try {
      const algorand = getAlgorandClient(networkId)

      const appClient = algorand.client.getTypedAppClientById(SignZeroClient, {
        appId,
        defaultSender: activeAddress || undefined,
      })

      // Get opinion info
      const infoResult = await appClient.send.getInfo({ args: {} })
      const [startRound, endRound, asaId, finalized, initialized] = infoResult.return!

      if (!initialized) {
        setError('Opinion not initialized')
        setLoading(false)
        return
      }

      // Get current round
      const status = await algorand.client.algod.status().do()
      const currentRound = BigInt(status.lastRound)

      // Get ASA info to get title, author, type, and URL
      const assetInfo = await algorand.client.algod.getAssetByID(Number(asaId)).do()
      const title = assetInfo.params.name || 'Untitled'
      const author = assetInfo.params.reserve || ''
      const opinionType = decodeOpinionType(assetInfo.params.metadataHash)
      const url = assetInfo.params.url || ''

      // Get author NFD
      const authorNfdResult = await lookupNFD(author)

      // Get opinion text from box
      let text = ''
      try {
        const boxResult = await algorand.client.algod
          .getApplicationBoxByName(Number(appId), new TextEncoder().encode('text'))
          .do()
        text = new TextDecoder().decode(boxResult.value)
      } catch {
        text = '(Unable to load opinion text)'
      }

      // Count signatures by checking ASA holders
      let signatureCount = 0
      try {
        const balances = await algorand.client.indexer
          .lookupAssetBalances(Number(asaId))
          .do()
        signatureCount = balances.balances?.length || 0
      } catch {
        // Indexer might not be available on localnet
      }

      // Check if current user has signed
      if (activeAddress) {
        try {
          const accountInfo = await algorand.account.getInformation(activeAddress)
          setHasSigned(accountInfo.assets?.some((a) => a.assetId === asaId) || false)
        } catch {
          setHasSigned(false)
        }
      }

      setOpinion({
        startRound,
        endRound,
        asaId,
        finalized,
        initialized,
        title,
        text,
        opinionType,
        url,
        author,
        authorNfd: authorNfdResult?.name || null,
        signatureCount,
        currentRound,
      })
    } catch (err) {
      console.error('Error loading opinion:', err)
      setError(err instanceof Error ? err.message : 'Failed to load opinion')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadOpinion()
  }, [appId, networkId, activeAddress])

  const handleSign = async () => {
    if (!activeAddress || !transactionSigner || !opinion) return

    setSigning(true)
    setError(null)

    try {
      const algorand = getAlgorandClient(networkId)
      algorand.setSigner(activeAddress, transactionSigner)

      const appClient = algorand.client.getTypedAppClientById(SignZeroClient, {
        appId,
        defaultSender: activeAddress,
      })

      // Sign opinion: app call + ASA opt-in
      await appClient
        .newGroup()
        .sign({ args: {} })
        .addTransaction(
          await algorand.createTransaction.assetTransfer({
            sender: activeAddress,
            receiver: activeAddress,
            assetId: opinion.asaId,
            amount: 0n,
          })
        )
        .send()

      setHasSigned(true)
      await loadOpinion()
    } catch (err) {
      console.error('Error signing opinion:', err)
      setError(err instanceof Error ? err.message : 'Failed to sign opinion')
    } finally {
      setSigning(false)
    }
  }

  const handleFinalize = async () => {
    if (!activeAddress || !transactionSigner || !opinion) return

    setFinalizing(true)
    setError(null)

    try {
      const algorand = getAlgorandClient(networkId)
      algorand.setSigner(activeAddress, transactionSigner)

      const appClient = algorand.client.getTypedAppClientById(SignZeroClient, {
        appId,
        defaultSender: activeAddress,
      })

      await appClient.send.finalize({
        args: {},
        extraFee: microAlgo(2000),
      })

      await loadOpinion()
    } catch (err) {
      console.error('Error finalizing opinion:', err)
      setError(err instanceof Error ? err.message : 'Failed to finalize opinion')
    } finally {
      setFinalizing(false)
    }
  }

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin w-8 h-8 border-2 border-emerald-400 border-t-transparent rounded-full mx-auto mb-4" />
        <p className="text-gray-400">Loading opinion...</p>
      </div>
    )
  }

  if (error && !opinion) {
    return (
      <div className="text-center py-12">
        <p className="text-red-400">{error}</p>
      </div>
    )
  }

  if (!opinion) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-400">Opinion not found</p>
      </div>
    )
  }

  const isActive = opinion.currentRound <= opinion.endRound && !opinion.finalized
  const canFinalize = opinion.currentRound > opinion.endRound && !opinion.finalized
  const roundsRemaining = isActive ? opinion.endRound - opinion.currentRound : 0n
  const timeRemaining = Number(roundsRemaining) * 3.3 // seconds
  const daysRemaining = Math.floor(timeRemaining / 86400)
  const hoursRemaining = Math.floor((timeRemaining % 86400) / 3600)

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          {opinion.opinionType && (
            <span className="px-3 py-1 bg-blue-500/20 text-blue-400 text-sm rounded-full">
              {opinion.opinionType}
            </span>
          )}
          {isActive ? (
            <span className="px-3 py-1 bg-emerald-500/20 text-emerald-400 text-sm rounded-full">
              Active
            </span>
          ) : opinion.finalized ? (
            <span className="px-3 py-1 bg-gray-500/20 text-gray-400 text-sm rounded-full">
              Finalized
            </span>
          ) : (
            <span className="px-3 py-1 bg-yellow-500/20 text-yellow-400 text-sm rounded-full">
              Ended
            </span>
          )}
          <span className="text-gray-500 text-sm">App ID: {appId.toString()}</span>
        </div>
        <h1 className="text-3xl font-bold mb-2">{opinion.title}</h1>
        <p className="text-gray-400">
          Created by{' '}
          <span className="text-emerald-400">
            {opinion.authorNfd || truncateAddress(opinion.author, 6)}
          </span>
        </p>
        {opinion.url && (
          <a
            href={opinion.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-cyan-400 hover:text-cyan-300 text-sm mt-1 inline-block"
          >
            {opinion.url}
          </a>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-emerald-400">
            {opinion.signatureCount}
          </div>
          <div className="text-sm text-gray-400">Signatures</div>
        </div>
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold">
            {isActive ? `${daysRemaining}d ${hoursRemaining}h` : '--'}
          </div>
          <div className="text-sm text-gray-400">Time Remaining</div>
        </div>
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-cyan-400">
            {opinion.asaId.toString()}
          </div>
          <div className="text-sm text-gray-400">ASA ID</div>
        </div>
      </div>

      {/* Content */}
      <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-6 mb-8">
        <h2 className="font-semibold mb-4">
          {opinion.opinionType || 'Opinion'} Text
        </h2>
        <p className="text-gray-300 whitespace-pre-wrap">{opinion.text}</p>
      </div>

      {/* Actions */}
      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 text-red-400 mb-4">
          {error}
        </div>
      )}

      {!activeAddress ? (
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-6 text-center">
          <p className="text-gray-400 mb-4">Connect your wallet to sign this opinion</p>
        </div>
      ) : hasSigned ? (
        <div className="bg-emerald-900/30 border border-emerald-700 rounded-lg p-6 text-center">
          <p className="text-emerald-400">You have signed this opinion</p>
        </div>
      ) : isActive ? (
        <button
          onClick={handleSign}
          disabled={signing}
          className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-lg font-medium text-lg transition-colors"
        >
          {signing ? 'Signing...' : 'Sign'}
        </button>
      ) : canFinalize ? (
        <button
          onClick={handleFinalize}
          disabled={finalizing}
          className="w-full py-4 bg-cyan-600 hover:bg-cyan-500 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-lg font-medium text-lg transition-colors"
        >
          {finalizing ? 'Finalizing...' : 'Finalize (Claim Reward)'}
        </button>
      ) : (
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-6 text-center">
          <p className="text-gray-400">This opinion has ended and been finalized</p>
        </div>
      )}

      {/* Technical Info */}
      <details className="mt-8">
        <summary className="text-gray-500 cursor-pointer hover:text-gray-400">
          Technical Details
        </summary>
        <div className="mt-4 bg-gray-800/30 rounded-lg p-4 text-sm text-gray-400 space-y-2">
          <div>
            <span className="text-gray-500">Start Round:</span>{' '}
            {opinion.startRound.toString()}
          </div>
          <div>
            <span className="text-gray-500">End Round:</span>{' '}
            {opinion.endRound.toString()}
          </div>
          <div>
            <span className="text-gray-500">Current Round:</span>{' '}
            {opinion.currentRound.toString()}
          </div>
          <div>
            <span className="text-gray-500">Author Address:</span> {opinion.author}
          </div>
        </div>
      </details>
    </div>
  )
}
