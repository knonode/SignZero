import { AlgorandClient } from '@algorandfoundation/algokit-utils'

export type NetworkId = 'localnet' | 'testnet' | 'mainnet'

export function getAlgorandClient(networkId: NetworkId): AlgorandClient {
  switch (networkId) {
    case 'localnet':
      return AlgorandClient.fromConfig({
        algodConfig: {
          server: 'http://localhost',
          port: 4001,
          token: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
        indexerConfig: {
          server: 'http://localhost',
          port: 8980,
          token: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
      })
    case 'testnet':
      return AlgorandClient.testNet()
    case 'mainnet':
      return AlgorandClient.mainNet()
    default:
      return AlgorandClient.fromEnvironment()
  }
}

export function getNetworkConfig(networkId: NetworkId) {
  switch (networkId) {
    case 'localnet':
      return {
        algodServer: 'http://localhost',
        algodPort: 4001,
        algodToken: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        indexerServer: 'http://localhost',
        indexerPort: 8980,
        indexerToken: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      }
    case 'testnet':
      return {
        algodServer: 'https://testnet-api.algonode.cloud',
        algodPort: 443,
        algodToken: '',
        indexerServer: 'https://testnet-idx.algonode.cloud',
        indexerPort: 443,
        indexerToken: '',
      }
    case 'mainnet':
      return {
        algodServer: 'https://mainnet-api.algonode.cloud',
        algodPort: 443,
        algodToken: '',
        indexerServer: 'https://mainnet-idx.algonode.cloud',
        indexerPort: 443,
        indexerToken: '',
      }
  }
}
