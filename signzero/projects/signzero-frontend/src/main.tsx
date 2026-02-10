import { Buffer } from 'buffer'
globalThis.Buffer = Buffer

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { WalletProvider } from '@txnlab/use-wallet-react'
import {
  WalletManager,
  WalletId,
  NetworkId,
} from '@txnlab/use-wallet'
import { ThemeProvider } from './ThemeContext'
import { ToastProvider } from './components/Toast'
import './index.css'
import App from './App'

const networkId = (import.meta.env.VITE_NETWORK || 'localnet') as string

const getNetworkId = (): NetworkId => {
  switch (networkId) {
    case 'testnet':
      return NetworkId.TESTNET
    case 'mainnet':
      return NetworkId.MAINNET
    default:
      return NetworkId.LOCALNET
  }
}

const walletManager = new WalletManager({
  wallets: [
    WalletId.DEFLY,
    WalletId.PERA,
    WalletId.LUTE,
    WalletId.KIBISIS,
    WalletId.EXODUS,
    WalletId.KMD,
  ],
  defaultNetwork: getNetworkId(),
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <ToastProvider>
        <WalletProvider manager={walletManager}>
          <App />
        </WalletProvider>
      </ToastProvider>
    </ThemeProvider>
  </StrictMode>
)
