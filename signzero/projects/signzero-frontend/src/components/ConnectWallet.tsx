import { useWallet } from '@txnlab/use-wallet-react'
import { useState, useEffect } from 'react'
import { lookupNFD, truncateAddress } from '../utils/nfd'

export function ConnectWallet() {
  const { wallets, activeAddress, activeWallet } = useWallet()
  const [showModal, setShowModal] = useState(false)
  const [nfdName, setNfdName] = useState<string | null>(null)

  useEffect(() => {
    if (activeAddress) {
      lookupNFD(activeAddress).then((result) => {
        setNfdName(result?.name || null)
      })
    } else {
      setNfdName(null)
    }
  }, [activeAddress])

  const handleDisconnect = async () => {
    if (activeWallet) {
      await activeWallet.disconnect()
    }
  }

  if (activeAddress) {
    return (
      <div className="flex items-center gap-3">
        <div className="text-right">
          <div className="text-sm font-medium text-[var(--accent-green)]">
            {nfdName || truncateAddress(activeAddress, 6)}
          </div>
          {nfdName && (
            <div className="text-xs text-[var(--text-secondary)]">
              {truncateAddress(activeAddress, 4)}
            </div>
          )}
        </div>
        <button
          onClick={handleDisconnect}
          className="px-3 py-2 text-sm bg-[var(--bg-hover)] hover:bg-[var(--bg-hover-strong)] transition-colors border border-[var(--border)]"
        >
          Disconnect
        </button>
      </div>
    )
  }

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className="px-4 py-2 bg-[var(--bg-accent)] text-[var(--text-inverse)] font-medium hover:bg-[var(--accent-green)] transition-colors"
      >
        Connect Wallet
      </button>

      {showModal && (
        <div className="fixed inset-0 bg-[var(--bg-overlay)] flex items-center justify-center z-50">
          <div className="bg-[var(--bg-surface)] border border-[var(--border)] p-6 max-w-sm w-full mx-4">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-semibold">Connect Wallet</h2>
              <button
                onClick={() => setShowModal(false)}
                className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                X
              </button>
            </div>

            <div className="space-y-3">
              {wallets.map((wallet) => (
                <button
                  key={wallet.id}
                  onClick={async () => {
                    await wallet.connect()
                    setShowModal(false)
                  }}
                  disabled={wallet.isConnected}
                  className="w-full flex items-center gap-4 p-4 bg-[var(--bg-subtle)] hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-50 border border-[var(--border)]"
                >
                  {wallet.metadata.icon && (
                    <img
                      src={wallet.metadata.icon}
                      alt={wallet.metadata.name}
                      className="w-8 h-8"
                    />
                  )}
                  <span className="font-medium">{wallet.metadata.name}</span>
                  {wallet.isConnected && (
                    <span className="ml-auto text-xs text-[var(--accent-green)]">Connected</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
