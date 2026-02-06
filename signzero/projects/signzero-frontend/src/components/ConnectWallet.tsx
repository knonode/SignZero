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
          <div className="text-sm font-medium text-emerald-400">
            {nfdName || truncateAddress(activeAddress, 6)}
          </div>
          {nfdName && (
            <div className="text-xs text-gray-500">
              {truncateAddress(activeAddress, 4)}
            </div>
          )}
        </div>
        <button
          onClick={handleDisconnect}
          className="px-3 py-2 text-sm bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
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
        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg font-medium transition-colors"
      >
        Connect Wallet
      </button>

      {showModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 max-w-sm w-full mx-4">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-semibold">Connect Wallet</h2>
              <button
                onClick={() => setShowModal(false)}
                className="text-gray-400 hover:text-white"
              >
                ✕
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
                  className="w-full flex items-center gap-4 p-4 bg-gray-700/50 hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50"
                >
                  {wallet.metadata.icon && (
                    <img
                      src={wallet.metadata.icon}
                      alt={wallet.metadata.name}
                      className="w-8 h-8 rounded"
                    />
                  )}
                  <span className="font-medium">{wallet.metadata.name}</span>
                  {wallet.isConnected && (
                    <span className="ml-auto text-xs text-emerald-400">Connected</span>
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
