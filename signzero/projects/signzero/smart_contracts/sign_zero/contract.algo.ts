import {
  Contract,
  GlobalState,
  Box,
  Global,
  Txn,
  Asset,
  gtxn,
  itxn,
  assert,
  Uint64,
  Bytes,
  Account,
  abimethod,
  op,
} from '@algorandfoundation/algorand-typescript'
import type { uint64, bytes } from '@algorandfoundation/algorand-typescript'

// Constants (must use const with literal values)
const MIN_FUNDING = 20_000_000 // 20 ALGO in microAlgos
const MIN_DURATION = 25_000 // ~1 day in rounds

export class SignZero extends Contract {
  // Global state
  startRound = GlobalState<uint64>({ key: 'start' })
  endRound = GlobalState<uint64>({ key: 'end' })
  finalized = GlobalState<boolean>({ key: 'finalized' })
  asaId = GlobalState<uint64>({ key: 'asa' })
  initialized = GlobalState<boolean>({ key: 'init' })

  // Gate global state
  gFlags = GlobalState<uint64>({ key: 'gf' })      // bitfield: bit0=asaHold, bit1=asaDeny, bit2=balMin, bit3=balMax, bit4=online, bit5=age, bit6=nfd
  gBalMin = GlobalState<uint64>({ key: 'gbmin' })   // min ALGO balance (microAlgos)
  gBalMax = GlobalState<uint64>({ key: 'gbmax' })   // max ALGO balance (microAlgos)
  gMinAge = GlobalState<uint64>({ key: 'gage' })    // min account age in rounds

  // Box storage for opinion text
  opinionText = Box<string>({ key: 'text' })

  // Gate box storage
  gateHold = Box<bytes>({ key: 'gate_hold' })  // packed uint64[] ASA IDs signer must hold
  gateDeny = Box<bytes>({ key: 'gate_deny' })  // packed uint64[] ASA IDs signer must NOT hold
  gateNfd = Box<string>({ key: 'gate_nfd' })   // NFD root name (e.g., "dao.algo")

  /**
   * Creates the application (empty state)
   */
  public createApplication(): void {
    this.initialized.value = false
    this.finalized.value = false
  }

  /**
   * Initializes the opinion with funding, title, text size, duration, type, and optional URL
   * Must be called with a payment transaction in the same group
   * Text content is written separately via writeChunk calls (also in the same group)
   * @param title - Opinion title (becomes ASA name, max 32 chars)
   * @param textSize - Size of opinion text in bytes (box is pre-allocated)
   * @param duration - Duration in rounds (min 25,000)
   * @param opinionType - Opinion type (exactly 32 bytes, right-padded with zeros)
   * @param url - Optional author website (max 96 bytes)
   */
  public initialize(title: string, textSize: uint64, duration: uint64, opinionType: bytes, url: string): uint64 {
    // Verify not already initialized
    assert(!this.initialized.value, 'Already initialized')

    // Verify minimum funding (payment must be first txn in group)
    assert(Global.groupSize >= Uint64(2), 'Expected payment + app call')
    const payment = gtxn.PaymentTxn(Uint64(0))
    assert(
      payment.receiver.bytes === Global.currentApplicationAddress.bytes,
      'Payment must go to app'
    )
    assert(payment.amount >= Uint64(MIN_FUNDING), 'Minimum 20 ALGO required')

    // Verify duration
    assert(duration >= Uint64(MIN_DURATION), 'Minimum duration 25,000 rounds')

    // Verify title length (ASA name max 32 bytes)
    assert(title !== '', 'Title cannot be empty')
    assert(Bytes(title).length <= Uint64(32), 'Title exceeds 32 bytes')

    // Verify text size
    assert(textSize > Uint64(0), 'Text size must be > 0')
    assert(textSize <= Uint64(32768), 'Text exceeds 32KB')

    // Verify opinion type: must be exactly 32 bytes and not all zeros
    assert(opinionType.length === Uint64(32), 'Opinion type must be 32 bytes')
    assert(opinionType !== op.bzero(32), 'Opinion type cannot be empty')

    // Verify URL length
    assert(Bytes(url).length <= Uint64(96), 'URL exceeds 96 bytes')

    // Set opinion timing
    const startRound: uint64 = Global.round
    const endRound: uint64 = startRound + duration
    this.startRound.value = startRound
    this.endRound.value = endRound

    // Create empty box for opinion text (content written via writeChunk)
    this.opinionText.create({ size: textSize })

    // Create opinion ASA
    const asaResult = itxn
      .assetConfig({
        total: Uint64(0),
        decimals: Uint64(0),
        assetName: title,
        unitName: 'ZERO',
        metadataHash: opinionType.toFixed({ length: 32, strategy: 'assert-length' }),
        url: url,
        manager: Global.currentApplicationAddress,
        reserve: Txn.sender, // Opinion author stored here
        freeze: Account(),
        clawback: Account(),
        fee: Uint64(0),
      })
      .submit()

    const asaId: uint64 = asaResult.createdAsset.id
    this.asaId.value = asaId

    // Mark as initialized
    this.initialized.value = true

    return asaId
  }

  /**
   * Writes a chunk of opinion text into the pre-allocated box
   * Must be called after initialize and before finalize
   * @param offset - Byte offset within the box to start writing
   * @param data - Chunk of text data to write
   */
  public writeChunk(offset: uint64, data: bytes): void {
    assert(this.initialized.value, 'Not initialized')
    assert(!this.finalized.value, 'Opinion already finalized')

    // Only the author can write chunks
    assert(Txn.sender === Asset(this.asaId.value).reserve, 'Only author can write')

    // Write chunk into box (AVM validates bounds automatically)
    this.opinionText.replace(offset, data)
  }

  /**
   * Sets signer gate requirements (author only, callable once)
   * Gates are frontend-enforced; the contract stores config for persistence/display.
   * @param flags - Bitfield: bit0=asaHold, bit1=asaDeny, bit2=balMin, bit3=balMax, bit4=online, bit5=age, bit6=nfd
   * @param balMin - Min ALGO balance in microAlgos (used if bit2 set)
   * @param balMax - Max ALGO balance in microAlgos (used if bit3 set)
   * @param minAge - Min account age in rounds (used if bit5 set)
   * @param asaHold - Packed uint64[] of ASA IDs signer must hold (used if bit0 set)
   * @param asaDeny - Packed uint64[] of ASA IDs signer must NOT hold (used if bit1 set)
   * @param nfdRoot - NFD root name e.g. "dao.algo" (used if bit6 set)
   */
  public setGates(flags: uint64, balMin: uint64, balMax: uint64, minAge: uint64, asaHold: bytes, asaDeny: bytes, nfdRoot: string): void {
    assert(this.initialized.value, 'Not initialized')

    // Only the author can set gates
    assert(Txn.sender === Asset(this.asaId.value).reserve, 'Only author can set gates')

    // Gates can only be set once (gFlags == 0 means unset)
    assert(!this.gFlags.hasValue || this.gFlags.value === Uint64(0), 'Gates already set')

    // Must set at least one gate
    assert(flags > Uint64(0), 'Must enable at least one gate')

    // Store flags
    this.gFlags.value = flags

    // Store scalar values based on flags
    if (flags & Uint64(4)) {  // bit2 = balMin
      this.gBalMin.value = balMin
    }
    if (flags & Uint64(8)) {  // bit3 = balMax
      this.gBalMax.value = balMax
    }
    if (flags & Uint64(32)) {  // bit5 = age
      this.gMinAge.value = minAge
    }

    // Create boxes based on flags
    if (flags & Uint64(1)) {  // bit0 = asaHold
      assert(asaHold.length > Uint64(0), 'asaHold cannot be empty')
      assert(asaHold.length % Uint64(8) === Uint64(0), 'asaHold must be N*8 bytes')
      this.gateHold.create({ size: asaHold.length })
      this.gateHold.replace(0, asaHold)
    }
    if (flags & Uint64(2)) {  // bit1 = asaDeny
      assert(asaDeny.length > Uint64(0), 'asaDeny cannot be empty')
      assert(asaDeny.length % Uint64(8) === Uint64(0), 'asaDeny must be N*8 bytes')
      this.gateDeny.create({ size: asaDeny.length })
      this.gateDeny.replace(0, asaDeny)
    }
    if (flags & Uint64(64)) {  // bit6 = nfd
      assert(nfdRoot !== '', 'nfdRoot cannot be empty')
      this.gateNfd.create({ size: Bytes(nfdRoot).length })
      this.gateNfd.replace(0, Bytes(nfdRoot))
    }
  }

  /**
   * Signs the opinion (validates atomic group with ASA opt-in)
   * Must be called as first txn in atomic group where second txn is ASA opt-in
   */
  public sign(): void {
    // Verify initialized
    assert(this.initialized.value, 'Not initialized')

    // Verify opinion is active
    assert(Global.round <= this.endRound.value, 'Opinion has ended')
    assert(!this.finalized.value, 'Opinion already finalized')

    // Verify atomic group structure
    assert(Global.groupSize === Uint64(2), 'Expected app call + ASA opt-in')

    // Verify second transaction is valid ASA opt-in
    const optIn = gtxn.AssetTransferTxn(Uint64(1))
    assert(optIn.xferAsset.id === this.asaId.value, 'Must opt into opinion ASA')
    assert(optIn.assetAmount === Uint64(0), 'Must be opt-in (amount 0)')
    assert(optIn.sender.bytes === Txn.sender.bytes, 'Opt-in sender must match caller')
    assert(optIn.assetReceiver.bytes === Txn.sender.bytes, 'Opt-in receiver must match caller')
  }

  /**
   * Extends the opinion duration (author only)
   * @param newEndRound - New end round (must be greater than current)
   */
  public extend(newEndRound: uint64): void {
    // Verify initialized
    assert(this.initialized.value, 'Not initialized')

    // Verify caller is opinion author (stored in ASA reserve address)
    const asa = Asset(this.asaId.value)
    assert(Txn.sender.bytes === asa.reserve.bytes, 'Only author can extend')

    // Verify opinion not finalized
    assert(!this.finalized.value, 'Opinion already finalized')

    // Verify new end is greater than current
    assert(newEndRound > this.endRound.value, 'New end must be greater')

    // Update end round
    this.endRound.value = newEndRound
  }

  /**
   * Finalizes the opinion (anyone can call after end round)
   * Removes ASA manager and sends remaining balance to caller
   */
  public finalize(): void {
    // Verify initialized
    assert(this.initialized.value, 'Not initialized')

    // Verify opinion has ended
    assert(Global.round > this.endRound.value, 'Opinion still active')

    // Verify not already finalized
    assert(!this.finalized.value, 'Opinion already finalized')

    // Remove ASA manager (makes ASA immutable)
    const asa = Asset(this.asaId.value)
    itxn
      .assetConfig({
        configAsset: asa,
        manager: Account(),
        reserve: asa.reserve, // Keep author address
        freeze: Account(),
        clawback: Account(),
        fee: Uint64(0),
      })
      .submit()

    // Mark as finalized
    this.finalized.value = true

    // Calculate reward (contract balance minus minimum balance)
    const reward: uint64 =
      Global.currentApplicationAddress.balance - Global.currentApplicationAddress.minBalance

    // Send reward to finalizer
    if (reward > Uint64(0)) {
      itxn
        .payment({
          receiver: Txn.sender,
          amount: reward,
          fee: Uint64(0),
        })
        .submit()
    }
  }

  /**
   * Read-only: Get opinion info
   */
  @abimethod({ readonly: true })
  public getInfo(): [uint64, uint64, uint64, boolean, boolean] {
    return [
      this.startRound.value,
      this.endRound.value,
      this.asaId.value,
      this.finalized.value,
      this.initialized.value,
    ]
  }
}
