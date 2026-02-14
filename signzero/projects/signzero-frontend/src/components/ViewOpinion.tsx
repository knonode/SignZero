import { useState, useEffect } from 'react'
import { useWallet } from '@txnlab/use-wallet-react'
import { getAlgorandClient } from '../utils/algorand'
import type { NetworkId } from '../utils/algorand'
import { SignZeroClient } from '../contracts/SignZeroClient'
import { lookupNFD, truncateAddress } from '../utils/nfd'
import { decodeOpinionType, parseGlobalState, isSignZeroOpinion } from '../utils/signzero'
import { useToast } from './Toast'
import { getApplicationAddress } from 'algosdk'
import { microAlgo } from '@algorandfoundation/algokit-utils'
import { readGateConfig, checkAllGates, getGateLabels } from '../utils/gates'
import type { GateConfig, GateCheckResult } from '../utils/gates'

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
  appBalance: bigint
  appMinBalance: bigint
}

export function ViewOpinion({ appId, networkId }: ViewOpinionProps) {
  const { activeAddress, transactionSigner } = useWallet()
  const { addToast, updateToast } = useToast()
  const [opinion, setOpinion] = useState<OpinionInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [signing, setSigning] = useState(false)
  const [finalizing, setFinalizing] = useState(false)
  const [extending, setExtending] = useState(false)
  const [extendDays, setExtendDays] = useState(7)
  const [error, setError] = useState<string | null>(null)
  const [hasSigned, setHasSigned] = useState(false)
  const [gateConfig, setGateConfig] = useState<GateConfig | null>(null)
  const [gateResults, setGateResults] = useState<GateCheckResult[] | null>(null)
  const [checkingGates, setCheckingGates] = useState(false)

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

      // Fetch app account balance for reclaim display
      let appBalance = 0n
      let appMinBalance = 0n
      try {
        const appAddress = getApplicationAddress(appId).toString()
        const appAccountInfo = await algorand.client.algod.accountInformation(appAddress).do()
        appBalance = BigInt(appAccountInfo.amount)
        appMinBalance = BigInt(appAccountInfo.minBalance)
      } catch {
        // App account may not exist yet
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
        appBalance,
        appMinBalance,
      })

      // Load gate config
      try {
        const gates = await readGateConfig(appId, networkId)
        setGateConfig(gates)
      } catch {
        setGateConfig(null)
      }
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

  // Check gates when wallet connects and gate config is loaded
  useEffect(() => {
    if (!activeAddress || !gateConfig || hasSigned) {
      setGateResults(null)
      return
    }

    let cancelled = false
    setCheckingGates(true)

    checkAllGates(activeAddress, gateConfig, networkId)
      .then((results) => {
        if (!cancelled) setGateResults(results)
      })
      .catch(() => {
        if (!cancelled) setGateResults(null)
      })
      .finally(() => {
        if (!cancelled) setCheckingGates(false)
      })

    return () => { cancelled = true }
  }, [activeAddress, gateConfig, networkId, hasSigned])

  const gatesPassed = !gateConfig || !gateResults || gateResults.every((r) => r.passed)

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

  const isAuthor = activeAddress && opinion?.author === activeAddress

  const handleExtend = async () => {
    if (!activeAddress || !transactionSigner || !opinion) return

    setExtending(true)
    setError(null)

    const toastId = addToast('Approve the extend transaction in your wallet', 'loading')

    try {
      const algorand = getAlgorandClient(networkId)
      algorand.setSigner(activeAddress, transactionSigner)

      const appClient = algorand.client.getTypedAppClientById(SignZeroClient, {
        appId,
        defaultSender: activeAddress,
      })

      const roundsPerDay = Math.floor((24 * 60 * 60) / 3.3)
      const additionalRounds = BigInt(extendDays * roundsPerDay)
      const newEndRound = opinion.endRound + additionalRounds

      await appClient.send.extend({
        args: { newEndRound },
      })

      updateToast(toastId, `Opinion extended by ${extendDays} day${extendDays > 1 ? 's' : ''}!`, 'success')
      await loadOpinion()
    } catch (err) {
      console.error('Error extending opinion:', err)
      const msg = err instanceof Error ? err.message : 'Failed to extend opinion'
      updateToast(toastId, msg, 'error')
      setError(msg)
    } finally {
      setExtending(false)
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
        {canFinalize ? (
          <button
            onClick={handleFinalize}
            disabled={finalizing}
            className="bg-[var(--bg-card)] border border-[var(--accent-cyan)] p-4 text-center hover:bg-[var(--bg-surface)] transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
          >
            <div className="text-2xl font-bold text-[var(--accent-cyan)]">
              {((Number(opinion.appBalance - opinion.appMinBalance)) / 1_000_000).toFixed(2)} A
            </div>
            <div className="text-sm text-[var(--accent-cyan)]">
              {finalizing ? 'Finalizing...' : 'Reclaim'}
            </div>
          </button>
        ) : opinion.finalized ? (
          <div className="bg-[var(--bg-card)] border border-[var(--border)] p-4 text-center">
            <div className="text-2xl font-bold text-[var(--text-secondary)]">Finalized</div>
            <div className="text-sm text-[var(--text-secondary)]">Reclaimed</div>
          </div>
        ) : (
          <div className="bg-[var(--bg-card)] border border-[var(--border)] p-4 text-center">
            <div className="text-2xl font-bold">
              {`${daysRemaining}d ${hoursRemaining}h`}
            </div>
            <div className="text-sm text-[var(--text-secondary)]">Time Remaining</div>
          </div>
        )}
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

      {/* Gate Requirements */}
      {gateConfig && (
        <div className="bg-[var(--bg-card)] border border-[var(--border)] p-6 mb-4">
          <h3 className="font-semibold mb-3">Signer Requirements</h3>
          <div className="flex flex-wrap gap-2 mb-3">
            {getGateLabels(gateConfig).map((label, i) => (
              <span key={i} className="px-3 py-1 bg-[var(--bg-surface)] border border-[var(--accent-yellow)] text-[var(--accent-yellow)] text-sm">
                {label}
              </span>
            ))}
          </div>

          {/* Gate check results when wallet connected */}
          {activeAddress && !hasSigned && isActive && (
            checkingGates ? (
              <p className="text-sm text-[var(--text-secondary)]">Checking eligibility...</p>
            ) : gateResults && (
              <div className="space-y-1 mt-2">
                {gateResults.map((result, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <span className={result.passed ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}>
                      {result.passed ? '\u2713' : '\u2717'}
                    </span>
                    <span className={result.passed ? 'text-[var(--text-primary)]' : 'text-[var(--accent-red)]'}>
                      {result.gate}
                    </span>
                    <span className="text-[var(--text-secondary)]">
                      — {result.detail}
                    </span>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      )}

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
          disabled={signing || checkingGates || !gatesPassed}
          className="w-full py-4 bg-[var(--bg-accent)] text-[var(--text-inverse)] hover:bg-[var(--accent-green)] disabled:bg-[var(--bg-disabled)] disabled:text-[var(--text-secondary)] disabled:cursor-not-allowed font-medium text-lg transition-colors"
        >
          {signing ? 'Signing...' : checkingGates ? 'Checking eligibility...' : !gatesPassed ? 'Requirements not met' : 'Sign'}
        </button>
      ) : canFinalize ? (
        <div className="bg-[var(--bg-card)] border border-[var(--border)] p-6 text-center">
          <p className="text-[var(--text-secondary)]">This opinion has ended — use the Reclaim card above to finalize</p>
        </div>
      ) : (
        <div className="bg-[var(--bg-card)] border border-[var(--border)] p-6 text-center">
          <p className="text-[var(--text-secondary)]">This opinion has ended and been finalized</p>
        </div>
      )}

      {/* Extend Duration (author only) */}
      {isAuthor && isActive && (
        <div className="bg-[var(--bg-card)] border border-[var(--border)] p-6 mt-4">
          <h3 className="font-medium mb-3">Extend Duration</h3>
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="block text-sm text-[var(--text-secondary)] mb-1">Additional days</label>
              <input
                type="number"
                value={extendDays}
                onChange={(e) => setExtendDays(Math.max(1, parseInt(e.target.value) || 1))}
                min={1}
                max={365}
                className="w-full px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent-green)]"
              />
            </div>
            <button
              onClick={handleExtend}
              disabled={extending}
              className="px-6 py-2 bg-[var(--accent-cyan)] text-[var(--text-inverse)] hover:bg-[var(--accent-blue)] disabled:bg-[var(--bg-disabled)] disabled:text-[var(--text-secondary)] disabled:cursor-not-allowed transition-colors"
            >
              {extending ? 'Extending...' : 'Extend'}
            </button>
          </div>
          <p className="text-xs text-[var(--text-secondary)] mt-2">
            +{Math.floor((extendDays * 24 * 60 * 60) / 3.3).toLocaleString()} rounds
          </p>
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
