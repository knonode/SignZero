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
} from '@algorandfoundation/algorand-typescript'
import type { uint64, bytes } from '@algorandfoundation/algorand-typescript'

// Constants (must use const with literal values)
const MIN_FUNDING = 20_000_000 // 20 ALGO in microAlgos
const MIN_DURATION = 25_000 // ~1 day in rounds

export class SignZero extends Contract {
  // Global state
  petitionStartRound = GlobalState<uint64>({ key: 'start' })
  petitionEndRound = GlobalState<uint64>({ key: 'end' })
  petitionFinalized = GlobalState<boolean>({ key: 'finalized' })
  petitionAsaId = GlobalState<uint64>({ key: 'asa' })
  petitionInitialized = GlobalState<boolean>({ key: 'init' })

  // Box storage for petition text
  petitionText = Box<bytes>({ key: 'text' })

  /**
   * Creates the application (empty state)
   */
  public createApplication(): void {
    this.petitionInitialized.value = false
    this.petitionFinalized.value = false
  }

  /**
   * Initializes the petition with funding, title, text, and duration
   * Must be called with a payment transaction in the same group
   * @param title - Petition title (becomes ASA name, max 32 chars)
   * @param text - Petition content (stored in box, max 32KB)
   * @param duration - Duration in rounds (min 25,000)
   */
  public initializePetition(title: string, text: bytes, duration: uint64): uint64 {
    // Verify not already initialized
    assert(!this.petitionInitialized.value, 'Already initialized')

    // Verify minimum funding (payment must be first txn in group)
    assert(Global.groupSize === Uint64(2), 'Expected payment + app call')
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

    // Verify text is not empty
    assert(text !== Bytes(''), 'Text cannot be empty')

    // Set petition timing
    const startRound: uint64 = Global.round
    const endRound: uint64 = startRound + duration
    this.petitionStartRound.value = startRound
    this.petitionEndRound.value = endRound

    // Store petition text in box
    this.petitionText.value = text

    // Create petition ASA
    const asaResult = itxn
      .assetConfig({
        total: Uint64(0),
        decimals: Uint64(0),
        assetName: title,
        unitName: 'ZERO',
        manager: Global.currentApplicationAddress,
        reserve: Txn.sender, // Petition author stored here
        freeze: Account(),
        clawback: Account(),
        fee: Uint64(0),
      })
      .submit()

    const asaId: uint64 = asaResult.createdAsset.id
    this.petitionAsaId.value = asaId

    // Mark as initialized
    this.petitionInitialized.value = true

    return asaId
  }

  /**
   * Signs the petition (validates atomic group with ASA opt-in)
   * Must be called as first txn in atomic group where second txn is ASA opt-in
   */
  public signPetition(): void {
    // Verify initialized
    assert(this.petitionInitialized.value, 'Not initialized')

    // Verify petition is active
    assert(Global.round <= this.petitionEndRound.value, 'Petition has ended')
    assert(!this.petitionFinalized.value, 'Petition already finalized')

    // Verify atomic group structure
    assert(Global.groupSize === Uint64(2), 'Expected app call + ASA opt-in')

    // Verify second transaction is valid ASA opt-in
    const optIn = gtxn.AssetTransferTxn(Uint64(1))
    assert(optIn.xferAsset.id === this.petitionAsaId.value, 'Must opt into petition ASA')
    assert(optIn.assetAmount === Uint64(0), 'Must be opt-in (amount 0)')
    assert(optIn.sender.bytes === Txn.sender.bytes, 'Opt-in sender must match caller')
    assert(optIn.assetReceiver.bytes === Txn.sender.bytes, 'Opt-in receiver must match caller')
  }

  /**
   * Extends the petition duration (author only)
   * @param newEndRound - New end round (must be greater than current)
   */
  public extendPetition(newEndRound: uint64): void {
    // Verify initialized
    assert(this.petitionInitialized.value, 'Not initialized')

    // Verify caller is petition author (stored in ASA reserve address)
    const asa = Asset(this.petitionAsaId.value)
    assert(Txn.sender.bytes === asa.reserve.bytes, 'Only author can extend')

    // Verify petition not finalized
    assert(!this.petitionFinalized.value, 'Petition already finalized')

    // Verify new end is greater than current
    assert(newEndRound > this.petitionEndRound.value, 'New end must be greater')

    // Update end round
    this.petitionEndRound.value = newEndRound
  }

  /**
   * Finalizes the petition (anyone can call after end round)
   * Removes ASA manager and sends remaining balance to caller
   */
  public finalizePetition(): void {
    // Verify initialized
    assert(this.petitionInitialized.value, 'Not initialized')

    // Verify petition has ended
    assert(Global.round > this.petitionEndRound.value, 'Petition still active')

    // Verify not already finalized
    assert(!this.petitionFinalized.value, 'Petition already finalized')

    // Remove ASA manager (makes ASA immutable)
    const asa = Asset(this.petitionAsaId.value)
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
    this.petitionFinalized.value = true

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
   * Read-only: Get petition info
   */
  @abimethod({ readonly: true })
  public getPetitionInfo(): [uint64, uint64, uint64, boolean, boolean] {
    return [
      this.petitionStartRound.value,
      this.petitionEndRound.value,
      this.petitionAsaId.value,
      this.petitionFinalized.value,
      this.petitionInitialized.value,
    ]
  }
}
