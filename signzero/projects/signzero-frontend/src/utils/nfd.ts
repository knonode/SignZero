const NFD_API_URL = 'https://api.nf.domains'

interface NFDLookupResult {
  [address: string]: {
    name: string
    avatar?: string
  }
}

const nfdCache = new Map<string, { name: string; avatar?: string; timestamp: number }>()
const CACHE_TTL = 2 * 60 * 1000 // 2 minutes (matches CDN cache)

export async function lookupNFD(address: string): Promise<{ name: string; avatar?: string } | null> {
  // Check cache first
  const cached = nfdCache.get(address)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return { name: cached.name, avatar: cached.avatar }
  }

  try {
    const response = await fetch(
      `${NFD_API_URL}/nfd/lookup?address=${address}&view=tiny&allowUnverified=false`
    )

    if (!response.ok) {
      return null
    }

    const data = await response.json()

    if (data[address]) {
      const result = {
        name: data[address].name,
        avatar: data[address].avatar,
      }
      // Cache the result
      nfdCache.set(address, { ...result, timestamp: Date.now() })
      return result
    }

    return null
  } catch {
    return null
  }
}

export async function batchLookupNFD(
  addresses: string[]
): Promise<NFDLookupResult> {
  // Filter out cached addresses and deduplicate
  const uniqueAddresses = [...new Set(addresses)]
  const results: NFDLookupResult = {}
  const addressesToFetch: string[] = []

  for (const addr of uniqueAddresses) {
    const cached = nfdCache.get(addr)
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      results[addr] = { name: cached.name, avatar: cached.avatar }
    } else {
      addressesToFetch.push(addr)
    }
  }

  if (addressesToFetch.length === 0) {
    return results
  }

  // Batch in groups of 20 (API limit)
  const batches: string[][] = []
  for (let i = 0; i < addressesToFetch.length; i += 20) {
    batches.push(addressesToFetch.slice(i, i + 20))
  }

  for (const batch of batches) {
    try {
      const queryParams = batch.map((addr) => `address=${addr}`).join('&')
      const response = await fetch(
        `${NFD_API_URL}/nfd/lookup?${queryParams}&view=tiny&allowUnverified=false`
      )

      if (response.ok) {
        const data = await response.json()
        for (const addr of batch) {
          if (data[addr]) {
            const result = {
              name: data[addr].name,
              avatar: data[addr].avatar,
            }
            results[addr] = result
            nfdCache.set(addr, { ...result, timestamp: Date.now() })
          }
        }
      }
    } catch {
      // Continue with other batches on error
    }
  }

  return results
}

export function truncateAddress(address: string, chars = 4): string {
  if (!address) return ''
  return `${address.slice(0, chars)}...${address.slice(-chars)}`
}
