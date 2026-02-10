import { useState, useEffect } from 'react'
import { useWallet } from '@txnlab/use-wallet-react'
import { getAlgorandClient } from '../utils/algorand'
import type { NetworkId } from '../utils/algorand'
import { SignZeroClient } from '../contracts/SignZeroClient'
import { lookupNFD, truncateAddress } from '../utils/nfd'
import { decodeOpinionType, parseGlobalState, isSignZeroOpinion } from '../utils/signzero'
import { useToast } from './Toast'
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

export function ViewOpinion({ appId, networkId }: ViewOpinionProps) {
  const { activeAddress, transactionSigner } = useWallet()
  const { addToast, updateToast } = useToast()
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

      // Read global state directly from algod — no wallet needed
      const appInfo = await algorand.client.algod.getApplicationByID(Number(appId)).do()
      const globalState = appInfo.params?.globalState
      if (!globalState) {
        setError('Application has no global state')
        setLoading(false)
        return
      }

      const parsed = parseGlobalState(globalState)
      if (!isSignZeroOpinion(parsed)) {
        setError('Not a SignZero opinion')
        setLoading(false)
        return
      }

      const initialized = parsed.init === 1n
      if (!initialized) {
        setError('Opinion not initialized')
        setLoading(false)
        return
      }

      const startRound = parsed.start as bigint
      const endRound = parsed.end as bigint
      const asaId = parsed.asa as bigint
      const finalized = parsed.finalized === 1n

      const status = await algorand.client.algod.status().do()
      const currentRound = BigInt(status.lastRound)

      const assetInfo = await algorand.client.algod.getAssetByID(Number(asaId)).do()
      const title = assetInfo.params.name || 'Untitled'
      const author = assetInfo.params.reserve || ''
      const opinionType = decodeOpinionType(assetInfo.params.metadataHash)
      const url = assetInfo.params.url || ''

      const authorNfdResult = networkId !== 'localnet' ? await lookupNFD(author) : null

      let text = ''
      try {
        const boxResult = await algorand.client.algod
          .getApplicationBoxByName(Number(appId), new TextEncoder().encode('text'))
          .do()
        text = new TextDecoder().decode(boxResult.value)
      } catch {
        text = '(Unable to load opinion text)'
      }

      let signatureCount = 0
      try {
        const balances = await algorand.client.indexer
          .lookupAssetBalances(Number(asaId))
          .do()
        signatureCount = balances.balances?.length || 0
      } catch {
        // Indexer might not be available
      }

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

    const toastId = addToast('Approve the signing transaction in your wallet (app call + ASA opt-in)', 'loading')

    try {
      const algorand = getAlgorandClient(networkId)
      algorand.setSigner(activeAddress, transactionSigner)

      const appClient = algorand.client.getTypedAppClientById(SignZeroClient, {
        appId,
        defaultSender: activeAddress,
      })

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

      updateToast(toastId, 'Signature recorded on the blockchain!', 'success')
      setHasSigned(true)
      await loadOpinion()
    } catch (err) {
      console.error('Error signing opinion:', err)
      const msg = err instanceof Error ? err.message : 'Failed to sign opinion'
      updateToast(toastId, msg, 'error')
      setError(msg)
    } finally {
      setSigning(false)
    }
  }

  const handleFinalize = async () => {
    if (!activeAddress || !transactionSigner || !opinion) return

    setFinalizing(true)
    setError(null)

    const toastId = addToast('Approve the finalization transaction in your wallet', 'loading')

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

      updateToast(toastId, 'Opinion finalized! Remaining balance claimed.', 'success')
      await loadOpinion()
    } catch (err) {
      console.error('Error finalizing opinion:', err)
      const msg = err instanceof Error ? err.message : 'Failed to finalize opinion'
      updateToast(toastId, msg, 'error')
      setError(msg)
    } finally {
      setFinalizing(false)
    }
  }

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin w-8 h-8 border-2 border-[var(--accent-green)] border-t-transparent mx-auto mb-4" />
        <p className="text-[var(--text-secondary)]">Loading opinion...</p>
      </div>
    )
  }

  if (error && !opinion) {
    return (
      <div className="text-center py-12">
        <p className="text-[var(--accent-red)]">{error}</p>
      </div>
    )
  }

  if (!opinion) {
    return (
      <div className="text-center py-12">
        <p className="text-[var(--text-secondary)]">Opinion not found</p>
      </div>
    )
  }

  const isActive = opinion.currentRound <= opinion.endRound && !opinion.finalized
  const canFinalize = opinion.currentRound > opinion.endRound && !opinion.finalized
  const roundsRemaining = isActive ? opinion.endRound - opinion.currentRound : 0n
  const timeRemaining = Number(roundsRemaining) * 3.3
  const daysRemaining = Math.floor(timeRemaining / 86400)
  const hoursRemaining = Math.floor((timeRemaining % 86400) / 3600)

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          {opinion.opinionType && (
            <span className="px-3 py-1 bg-[var(--bg-surface)] border border-[var(--accent-blue)] text-[var(--accent-blue)] text-sm">
              {opinion.opinionType}
            </span>
          )}
          {isActive ? (
            <span className="px-3 py-1 bg-[var(--bg-surface)] border border-[var(--accent-green)] text-[var(--accent-green)] text-sm">
              Active
            </span>
          ) : opinion.finalized ? (
            <span className="px-3 py-1 bg-[var(--bg-surface)] border border-[var(--text-secondary)] text-[var(--text-secondary)] text-sm">
              Finalized
            </span>
          ) : (
            <span className="px-3 py-1 bg-[var(--bg-surface)] border border-[var(--accent-yellow)] text-[var(--accent-yellow)] text-sm">
              Ended
            </span>
          )}
          <span className="text-[var(--text-secondary)] text-sm">App ID: {appId.toString()}</span>
        </div>
        <h1 className="text-3xl font-bold mb-2">{opinion.title}</h1>
        <p className="text-[var(--text-secondary)]">
          Created by{' '}
          <span className="text-[var(--accent-green)]">
            {opinion.authorNfd || truncateAddress(opinion.author, 6)}
          </span>
        </p>
        {opinion.url && (
          <a
            href={opinion.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--accent-cyan)] hover:underline text-sm mt-1 inline-block"
          >
            {opinion.url}
          </a>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-[var(--bg-card)] border border-[var(--border)] p-4 text-center">
          <div className="text-2xl font-bold text-[var(--accent-green)]">
            {opinion.signatureCount}
          </div>
          <div className="text-sm text-[var(--text-secondary)]">Signatures</div>
        </div>
        <div className="bg-[var(--bg-card)] border border-[var(--border)] p-4 text-center">
          <div className="text-2xl font-bold">
            {isActive ? `${daysRemaining}d ${hoursRemaining}h` : '--'}
          </div>
          <div className="text-sm text-[var(--text-secondary)]">Time Remaining</div>
        </div>
        {networkId === 'mainnet' || networkId === 'testnet' ? (
          <a
            href={networkId === 'mainnet'
              ? `https://allo.info/asset/${opinion.asaId}`
              : `https://lora.algokit.io/testnet/asset/${opinion.asaId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-[var(--bg-card)] border border-[var(--border)] p-4 text-center hover:border-[var(--accent-cyan)] transition-colors"
          >
            <div className="text-2xl font-bold text-[var(--accent-cyan)]">
              {opinion.asaId.toString()}
            </div>
            <div className="text-sm text-[var(--text-secondary)]">ASA ID</div>
          </a>
        ) : (
          <div className="bg-[var(--bg-card)] border border-[var(--border)] p-4 text-center">
            <div className="text-2xl font-bold text-[var(--accent-cyan)]">
              {opinion.asaId.toString()}
            </div>
            <div className="text-sm text-[var(--text-secondary)]">ASA ID</div>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="bg-[var(--bg-card)] border border-[var(--border)] p-6 mb-8">
        <h2 className="font-semibold mb-4">
          {opinion.opinionType || 'Opinion'} Text
        </h2>
        <p className="text-[var(--text-content)] whitespace-pre-wrap">{opinion.text}</p>
      </div>

      {/* Actions */}
      {error && (
        <div className="bg-[var(--bg-surface)] border border-[var(--accent-red)] p-4 text-[var(--accent-red)] mb-4">
          {error}
        </div>
      )}

      {!activeAddress ? (
        <div className="bg-[var(--bg-card)] border border-[var(--border)] p-6 text-center">
          <p className="text-[var(--text-secondary)]">Connect your wallet to sign this opinion</p>
        </div>
      ) : hasSigned ? (
        <div className="bg-[var(--bg-surface)] border border-[var(--accent-green)] p-6 text-center">
          <p className="text-[var(--accent-green)]">You have signed this opinion</p>
        </div>
      ) : isActive ? (
        <button
          onClick={handleSign}
          disabled={signing}
          className="w-full py-4 bg-[var(--bg-accent)] text-[var(--text-inverse)] hover:bg-[var(--accent-green)] disabled:bg-[var(--bg-disabled)] disabled:text-[var(--text-secondary)] disabled:cursor-not-allowed font-medium text-lg transition-colors"
        >
          {signing ? 'Signing...' : 'Sign'}
        </button>
      ) : canFinalize ? (
        <button
          onClick={handleFinalize}
          disabled={finalizing}
          className="w-full py-4 bg-[var(--accent-cyan)] text-[var(--text-inverse)] hover:bg-[var(--bg-accent)] disabled:bg-[var(--bg-disabled)] disabled:text-[var(--text-secondary)] disabled:cursor-not-allowed font-medium text-lg transition-colors"
        >
          {finalizing ? 'Finalizing...' : 'Finalize (Claim Reward)'}
        </button>
      ) : (
        <div className="bg-[var(--bg-card)] border border-[var(--border)] p-6 text-center">
          <p className="text-[var(--text-secondary)]">This opinion has ended and been finalized</p>
        </div>
      )}

      {/* Technical Info */}
      <details className="mt-8">
        <summary className="text-[var(--text-secondary)] cursor-pointer hover:text-[var(--text-primary)]">
          Technical Details
        </summary>
        <div className="mt-4 bg-[var(--bg-card)] border border-[var(--border)] p-4 text-sm text-[var(--text-secondary)] space-y-2">
          <div>
            <span className="text-[var(--text-secondary)]">Start Round:</span>{' '}
            <span className="text-[var(--text-primary)]">{opinion.startRound.toString()}</span>
          </div>
          <div>
            <span className="text-[var(--text-secondary)]">End Round:</span>{' '}
            <span className="text-[var(--text-primary)]">{opinion.endRound.toString()}</span>
          </div>
          <div>
            <span className="text-[var(--text-secondary)]">Current Round:</span>{' '}
            <span className="text-[var(--text-primary)]">{opinion.currentRound.toString()}</span>
          </div>
          <div>
            <span className="text-[var(--text-secondary)]">Author Address:</span>{' '}
            <span className="text-[var(--text-primary)]">{opinion.author}</span>
          </div>
        </div>
      </details>
    </div>
  )
}
