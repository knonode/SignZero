import { getAlgorandClient } from './algorand'
import type { NetworkId } from './algorand'

const NFD_API_URL = 'https://api.nf.domains'

// Gate flag bits
export const GATE_ASA_HOLD = 1   // bit0
export const GATE_ASA_DENY = 2   // bit1
export const GATE_BAL_MIN = 4    // bit2
export const GATE_BAL_MAX = 8    // bit3
export const GATE_ONLINE = 16    // bit4
export const GATE_AGE = 32       // bit5
export const GATE_NFD = 64       // bit6

export interface GateConfig {
  flags: number
  balMin?: bigint       // microAlgos
  balMax?: bigint       // microAlgos
  minAge?: bigint       // rounds
  asaHoldIds?: bigint[] // ASA IDs signer must hold
  asaDenyIds?: bigint[] // ASA IDs signer must NOT hold
  nfdRoot?: string      // NFD root name
}

export interface GateCheckResult {
  gate: string
  passed: boolean
  detail: string
}

/** Decode packed uint64 array (N×8 bytes big-endian) into bigint[] */
export function unpackUint64Array(data: Uint8Array): bigint[] {
  const ids: bigint[] = []
  for (let i = 0; i + 8 <= data.length; i += 8) {
    let val = 0n
    for (let j = 0; j < 8; j++) {
      val = (val << 8n) | BigInt(data[i + j])
    }
    ids.push(val)
  }
  return ids
}

/** Pack bigint[] into N×8 bytes big-endian Uint8Array */
export function packUint64Array(ids: bigint[]): Uint8Array {
  const data = new Uint8Array(ids.length * 8)
  for (let i = 0; i < ids.length; i++) {
    let val = ids[i]
    for (let j = 7; j >= 0; j--) {
      data[i * 8 + j] = Number(val & 0xffn)
      val >>= 8n
    }
  }
  return data
}

/** Read gate config from app global state and boxes */
export async function readGateConfig(appId: bigint, networkId: NetworkId): Promise<GateConfig | null> {
  const algorand = getAlgorandClient(networkId)

  const appInfo = await algorand.client.algod.getApplicationByID(Number(appId)).do()
  const globalState = appInfo.params?.globalState
  if (!globalState) return null

  // Parse global state
  let flags = 0
  let balMin: bigint | undefined
  let balMax: bigint | undefined
  let minAge: bigint | undefined

  for (const item of globalState) {
    let key: string
    if (typeof item.key === 'string') {
      key = atob(item.key)
    } else {
      key = new TextDecoder().decode(item.key)
    }

    if (key === 'gf' && item.value.type === 2) flags = Number(item.value.uint || 0)
    if (key === 'gbmin' && item.value.type === 2) balMin = BigInt(item.value.uint || 0)
    if (key === 'gbmax' && item.value.type === 2) balMax = BigInt(item.value.uint || 0)
    if (key === 'gage' && item.value.type === 2) minAge = BigInt(item.value.uint || 0)
  }

  if (flags === 0) return null

  const config: GateConfig = { flags }

  if (flags & GATE_BAL_MIN) config.balMin = balMin
  if (flags & GATE_BAL_MAX) config.balMax = balMax
  if (flags & GATE_AGE) config.minAge = minAge

  // Read boxes
  if (flags & GATE_ASA_HOLD) {
    try {
      const box = await algorand.client.algod
        .getApplicationBoxByName(Number(appId), new TextEncoder().encode('gate_hold'))
        .do()
      config.asaHoldIds = unpackUint64Array(box.value)
    } catch { /* box may not exist */ }
  }

  if (flags & GATE_ASA_DENY) {
    try {
      const box = await algorand.client.algod
        .getApplicationBoxByName(Number(appId), new TextEncoder().encode('gate_deny'))
        .do()
      config.asaDenyIds = unpackUint64Array(box.value)
    } catch { /* box may not exist */ }
  }

  if (flags & GATE_NFD) {
    try {
      const box = await algorand.client.algod
        .getApplicationBoxByName(Number(appId), new TextEncoder().encode('gate_nfd'))
        .do()
      config.nfdRoot = new TextDecoder().decode(box.value)
    } catch { /* box may not exist */ }
  }

  return config
}

/** Check if address holds all required ASAs */
export async function checkAsaHolding(
  address: string,
  asaIds: bigint[],
  networkId: NetworkId
): Promise<GateCheckResult[]> {
  const algorand = getAlgorandClient(networkId)
  const results: GateCheckResult[] = []

  const accountInfo = await algorand.account.getInformation(address)
  const heldAssets = new Set(accountInfo.assets?.map((a) => a.assetId) || [])

  for (const id of asaIds) {
    const held = heldAssets.has(id)
    results.push({
      gate: `Must hold ASA #${id}`,
      passed: held,
      detail: held ? 'Held' : 'Not held',
    })
  }

  return results
}

/** Check if address does NOT hold any denied ASAs */
export async function checkAsaDeny(
  address: string,
  asaIds: bigint[],
  networkId: NetworkId
): Promise<GateCheckResult[]> {
  const algorand = getAlgorandClient(networkId)
  const results: GateCheckResult[] = []

  const accountInfo = await algorand.account.getInformation(address)
  const heldAssets = new Set(accountInfo.assets?.map((a) => a.assetId) || [])

  for (const id of asaIds) {
    const held = heldAssets.has(id)
    results.push({
      gate: `Must NOT hold ASA #${id}`,
      passed: !held,
      detail: held ? 'Held (blocked)' : 'Not held',
    })
  }

  return results
}

/** Check ALGO balance min/max */
export async function checkBalance(
  address: string,
  min: bigint | undefined,
  max: bigint | undefined,
  networkId: NetworkId
): Promise<GateCheckResult[]> {
  const algorand = getAlgorandClient(networkId)
  const results: GateCheckResult[] = []

  const accountInfo = await algorand.client.algod.accountInformation(address).do()
  const balance = BigInt(accountInfo.amount)
  const balanceAlgo = Number(balance) / 1_000_000

  if (min !== undefined) {
    const minAlgo = Number(min) / 1_000_000
    results.push({
      gate: `Min ${minAlgo} ALGO balance`,
      passed: balance >= min,
      detail: `Balance: ${balanceAlgo.toFixed(2)} ALGO`,
    })
  }

  if (max !== undefined) {
    const maxAlgo = Number(max) / 1_000_000
    results.push({
      gate: `Max ${maxAlgo} ALGO balance`,
      passed: balance <= max,
      detail: `Balance: ${balanceAlgo.toFixed(2)} ALGO`,
    })
  }

  return results
}

/** Check if account is an online validator */
export async function checkOnlineStatus(
  address: string,
  networkId: NetworkId
): Promise<GateCheckResult> {
  const algorand = getAlgorandClient(networkId)
  const accountInfo = await algorand.client.algod.accountInformation(address).do()
  const isOnline = accountInfo.status === 'Online'

  return {
    gate: 'Online validator',
    passed: isOnline,
    detail: isOnline ? 'Online' : `Status: ${accountInfo.status}`,
  }
}

/** Check minimum account age in rounds */
export async function checkAccountAge(
  address: string,
  minRounds: bigint,
  networkId: NetworkId
): Promise<GateCheckResult> {
  const algorand = getAlgorandClient(networkId)

  const status = await algorand.client.algod.status().do()
  const currentRound = BigInt(status.lastRound)

  let createdAtRound = 0n
  try {
    const accountInfo = await algorand.client.indexer
      .lookupAccountByID(address)
      .do()
    createdAtRound = BigInt(accountInfo.account?.createdAtRound || 0)
  } catch {
    // Indexer unavailable
    return {
      gate: `Account age >= ${Number(minRounds)} rounds`,
      passed: false,
      detail: 'Unable to verify (indexer unavailable)',
    }
  }

  const age = currentRound - createdAtRound
  const ageDays = Math.floor((Number(age) * 3.3) / 86400)
  const requiredDays = Math.floor((Number(minRounds) * 3.3) / 86400)

  return {
    gate: `Account age >= ${requiredDays} days`,
    passed: age >= minRounds,
    detail: `Account age: ~${ageDays} days`,
  }
}

/** Check if address owns a segment of the given NFD root */
export async function checkNfdSegment(
  address: string,
  nfdRoot: string
): Promise<GateCheckResult> {
  try {
    // Look up all NFDs owned by the address
    const response = await fetch(
      `${NFD_API_URL}/nfd/lookup?address=${address}&view=tiny&allowUnverified=false`
    )

    if (!response.ok) {
      return {
        gate: `NFD segment of ${nfdRoot}`,
        passed: false,
        detail: 'No NFD found for address',
      }
    }

    const data = await response.json()
    const nfdEntry = data[address]
    if (!nfdEntry) {
      return {
        gate: `NFD segment of ${nfdRoot}`,
        passed: false,
        detail: 'No NFD found for address',
      }
    }

    // Check if user's NFD is a segment of the root
    // A segment of "dao.algo" would be "name.dao.algo"
    const rootWithoutAlgo = nfdRoot.replace(/\.algo$/, '')
    const name: string = nfdEntry.name
    const isSegment = name.endsWith(`.${rootWithoutAlgo}.algo`) && name !== nfdRoot

    return {
      gate: `NFD segment of ${nfdRoot}`,
      passed: isSegment,
      detail: isSegment ? `Owns ${name}` : `${name} is not a segment of ${nfdRoot}`,
    }
  } catch {
    return {
      gate: `NFD segment of ${nfdRoot}`,
      passed: false,
      detail: 'NFD lookup failed',
    }
  }
}

/** Run all active gate checks for the given config and address */
export async function checkAllGates(
  address: string,
  config: GateConfig,
  networkId: NetworkId
): Promise<GateCheckResult[]> {
  const results: GateCheckResult[] = []

  const promises: Promise<void>[] = []

  if ((config.flags & GATE_ASA_HOLD) && config.asaHoldIds?.length) {
    promises.push(
      checkAsaHolding(address, config.asaHoldIds, networkId).then((r) => results.push(...r))
    )
  }

  if ((config.flags & GATE_ASA_DENY) && config.asaDenyIds?.length) {
    promises.push(
      checkAsaDeny(address, config.asaDenyIds, networkId).then((r) => results.push(...r))
    )
  }

  if ((config.flags & GATE_BAL_MIN) || (config.flags & GATE_BAL_MAX)) {
    promises.push(
      checkBalance(
        address,
        (config.flags & GATE_BAL_MIN) ? config.balMin : undefined,
        (config.flags & GATE_BAL_MAX) ? config.balMax : undefined,
        networkId
      ).then((r) => results.push(...r))
    )
  }

  if (config.flags & GATE_ONLINE) {
    promises.push(
      checkOnlineStatus(address, networkId).then((r) => results.push(r))
    )
  }

  if ((config.flags & GATE_AGE) && config.minAge) {
    promises.push(
      checkAccountAge(address, config.minAge, networkId).then((r) => results.push(r))
    )
  }

  if ((config.flags & GATE_NFD) && config.nfdRoot) {
    promises.push(
      checkNfdSegment(address, config.nfdRoot).then((r) => results.push(r))
    )
  }

  await Promise.all(promises)
  return results
}

/** Get human-readable gate labels from config (for display without checking) */
export function getGateLabels(config: GateConfig): string[] {
  const labels: string[] = []

  if ((config.flags & GATE_ASA_HOLD) && config.asaHoldIds?.length) {
    for (const id of config.asaHoldIds) {
      labels.push(`Must hold ASA #${id}`)
    }
  }

  if ((config.flags & GATE_ASA_DENY) && config.asaDenyIds?.length) {
    for (const id of config.asaDenyIds) {
      labels.push(`Must NOT hold ASA #${id}`)
    }
  }

  if ((config.flags & GATE_BAL_MIN) && config.balMin !== undefined) {
    labels.push(`Min ${Number(config.balMin) / 1_000_000} ALGO`)
  }

  if ((config.flags & GATE_BAL_MAX) && config.balMax !== undefined) {
    labels.push(`Max ${Number(config.balMax) / 1_000_000} ALGO`)
  }

  if (config.flags & GATE_ONLINE) {
    labels.push('Online validator')
  }

  if ((config.flags & GATE_AGE) && config.minAge !== undefined) {
    const days = Math.floor((Number(config.minAge) * 3.3) / 86400)
    labels.push(`Account age >= ${days} days`)
  }

  if ((config.flags & GATE_NFD) && config.nfdRoot) {
    labels.push(`NFD segment of ${config.nfdRoot}`)
  }

  return labels
}
