import { describe, expect, it, beforeAll, beforeEach } from 'vitest'
import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { SignZeroFactory, SignZeroClient } from '../artifacts/sign_zero/SignZeroClient'
import { microAlgo } from '@algorandfoundation/algokit-utils'

describe('SignZero e2e tests', () => {
  let algorand: AlgorandClient
  let dispenser: Awaited<ReturnType<typeof algorand.account.localNetDispenser>>

  const title = 'Climate Action Petition'
  const text = new TextEncoder().encode(
    'We the undersigned call for immediate climate action to protect our planet for future generations.'
  )
  const duration = 25000n

  beforeAll(async () => {
    algorand = AlgorandClient.fromEnvironment()
    dispenser = await algorand.account.localNetDispenser()
  })

  // Helper to create funded accounts for each test
  async function createFundedAccounts() {
    const deployer = await algorand.account.random()
    const signer = await algorand.account.random()

    await algorand.send.payment({
      sender: dispenser.addr,
      receiver: deployer.addr,
      amount: (100).algo(),
    })
    await algorand.send.payment({
      sender: dispenser.addr,
      receiver: signer.addr,
      amount: (10).algo(),
    })

    const factory = algorand.client.getTypedAppFactory(SignZeroFactory, {
      defaultSender: deployer.addr,
    })

    return { deployer, signer, factory }
  }

  describe('Contract deployment', () => {
    it('should create application successfully', async () => {
      const { factory } = await createFundedAccounts()
      const { appClient, result } = await factory.send.create.createApplication({ args: {} })

      expect(result.appId).toBeGreaterThan(0n)
      expect(appClient.appAddress).toBeDefined()
    })
  })

  describe('Petition initialization', () => {
    it('should initialize petition with valid parameters', async () => {
      const { deployer, factory } = await createFundedAccounts()
      const { appClient } = await factory.send.create.createApplication({ args: {} })

      const initResult = await appClient
        .newGroup()
        .addTransaction(
          await algorand.createTransaction.payment({
            sender: deployer.addr,
            receiver: appClient.appAddress,
            amount: (20).algo(),
          })
        )
        .initializePetition({
          args: { title, text, duration },
          extraFee: microAlgo(1000),
        })
        .send()

      const asaId = initResult.returns?.[0]
      expect(asaId).toBeDefined()
      expect(asaId).toBeGreaterThan(0n)

      // Verify state (booleans come back as 1n/0n from global state)
      const state = await appClient.state.global.getAll()
      expect(state.petitionInitialized).toBe(1n)
      expect(state.petitionFinalized).toBe(0n)
      expect(state.petitionAsaId).toBe(asaId)
    })

    it('should fail with insufficient funding', async () => {
      const { deployer, factory } = await createFundedAccounts()
      const { appClient } = await factory.send.create.createApplication({ args: {} })

      await expect(
        appClient
          .newGroup()
          .addTransaction(
            await algorand.createTransaction.payment({
              sender: deployer.addr,
              receiver: appClient.appAddress,
              amount: (10).algo(), // Less than 20 ALGO minimum
            })
          )
          .initializePetition({
            args: { title, text, duration },
            extraFee: microAlgo(1000),
          })
          .send()
      ).rejects.toThrow()
    })

    it('should fail with duration too short', async () => {
      const { deployer, factory } = await createFundedAccounts()
      const { appClient } = await factory.send.create.createApplication({ args: {} })

      await expect(
        appClient
          .newGroup()
          .addTransaction(
            await algorand.createTransaction.payment({
              sender: deployer.addr,
              receiver: appClient.appAddress,
              amount: (20).algo(),
            })
          )
          .initializePetition({
            args: { title, text, duration: 10000n }, // Less than 25,000 minimum
            extraFee: microAlgo(1000),
          })
          .send()
      ).rejects.toThrow()
    })

    it('should prevent double initialization', async () => {
      const { deployer, factory } = await createFundedAccounts()
      const { appClient } = await factory.send.create.createApplication({ args: {} })

      // First initialization
      await appClient
        .newGroup()
        .addTransaction(
          await algorand.createTransaction.payment({
            sender: deployer.addr,
            receiver: appClient.appAddress,
            amount: (20).algo(),
          })
        )
        .initializePetition({
          args: { title, text, duration },
          extraFee: microAlgo(1000),
        })
        .send()

      // Second initialization should fail
      await expect(
        appClient
          .newGroup()
          .addTransaction(
            await algorand.createTransaction.payment({
              sender: deployer.addr,
              receiver: appClient.appAddress,
              amount: (20).algo(),
            })
          )
          .initializePetition({
            args: { title, text, duration },
            extraFee: microAlgo(1000),
          })
          .send()
      ).rejects.toThrow()
    })
  })

  describe('Petition signing', () => {
    it('should allow signing via ASA opt-in', async () => {
      const { deployer, signer, factory } = await createFundedAccounts()
      const { appClient } = await factory.send.create.createApplication({ args: {} })

      const initResult = await appClient
        .newGroup()
        .addTransaction(
          await algorand.createTransaction.payment({
            sender: deployer.addr,
            receiver: appClient.appAddress,
            amount: (20).algo(),
          })
        )
        .initializePetition({
          args: { title, text, duration },
          extraFee: microAlgo(1000),
        })
        .send()

      const asaId = initResult.returns?.[0] as bigint

      // Create signer client
      const signerClient = algorand.client.getTypedAppClientById(SignZeroClient, {
        appId: appClient.appId,
        defaultSender: signer.addr,
      })

      // Sign petition: app call + ASA opt-in in atomic group
      await signerClient
        .newGroup()
        .signPetition({ args: {} })
        .addTransaction(
          await algorand.createTransaction.assetTransfer({
            sender: signer.addr,
            receiver: signer.addr,
            assetId: asaId,
            amount: 0n,
          })
        )
        .send()

      // Verify signer opted into the ASA
      const signerInfo = await algorand.account.getInformation(signer.addr)
      const hasAsset = signerInfo.assets?.some((a) => a.assetId === asaId)
      expect(hasAsset).toBe(true)
    })

    it('should reject signing with wrong ASA', async () => {
      const { deployer, signer, factory } = await createFundedAccounts()
      const { appClient } = await factory.send.create.createApplication({ args: {} })

      await appClient
        .newGroup()
        .addTransaction(
          await algorand.createTransaction.payment({
            sender: deployer.addr,
            receiver: appClient.appAddress,
            amount: (20).algo(),
          })
        )
        .initializePetition({
          args: { title, text, duration },
          extraFee: microAlgo(1000),
        })
        .send()

      // Create a different ASA
      const fakeAsa = await algorand.send.assetCreate({
        sender: deployer.addr,
        total: 1000n,
        decimals: 0,
        assetName: 'Fake',
        unitName: 'FAKE',
      })

      // Opt signer into fake ASA first
      await algorand.send.assetOptIn({
        sender: signer.addr,
        assetId: fakeAsa.assetId,
      })

      const signerClient = algorand.client.getTypedAppClientById(SignZeroClient, {
        appId: appClient.appId,
        defaultSender: signer.addr,
      })

      // Try to sign with wrong ASA
      await expect(
        signerClient
          .newGroup()
          .signPetition({ args: {} })
          .addTransaction(
            await algorand.createTransaction.assetTransfer({
              sender: signer.addr,
              receiver: signer.addr,
              assetId: fakeAsa.assetId,
              amount: 0n,
            })
          )
          .send()
      ).rejects.toThrow()
    })
  })

  describe('Petition extension', () => {
    it('should allow author to extend petition', async () => {
      const { deployer, factory } = await createFundedAccounts()
      const { appClient } = await factory.send.create.createApplication({ args: {} })

      await appClient
        .newGroup()
        .addTransaction(
          await algorand.createTransaction.payment({
            sender: deployer.addr,
            receiver: appClient.appAddress,
            amount: (20).algo(),
          })
        )
        .initializePetition({
          args: { title, text, duration },
          extraFee: microAlgo(1000),
        })
        .send()

      const stateBefore = await appClient.state.global.getAll()
      const currentEnd = stateBefore.petitionEndRound as bigint
      const newEnd = currentEnd + 10000n

      await appClient.send.extendPetition({
        args: { newEndRound: newEnd },
      })

      const stateAfter = await appClient.state.global.getAll()
      expect(stateAfter.petitionEndRound).toBe(newEnd)
    })

    it('should reject extension from non-author', async () => {
      const { deployer, signer, factory } = await createFundedAccounts()
      const { appClient } = await factory.send.create.createApplication({ args: {} })

      await appClient
        .newGroup()
        .addTransaction(
          await algorand.createTransaction.payment({
            sender: deployer.addr,
            receiver: appClient.appAddress,
            amount: (20).algo(),
          })
        )
        .initializePetition({
          args: { title, text, duration },
          extraFee: microAlgo(1000),
        })
        .send()

      const stateBefore = await appClient.state.global.getAll()
      const currentEnd = stateBefore.petitionEndRound as bigint
      const newEnd = currentEnd + 10000n

      const signerClient = algorand.client.getTypedAppClientById(SignZeroClient, {
        appId: appClient.appId,
        defaultSender: signer.addr,
      })

      await expect(
        signerClient.send.extendPetition({
          args: { newEndRound: newEnd },
        })
      ).rejects.toThrow()
    })

    it('should reject extension to earlier end round', async () => {
      const { deployer, factory } = await createFundedAccounts()
      const { appClient } = await factory.send.create.createApplication({ args: {} })

      await appClient
        .newGroup()
        .addTransaction(
          await algorand.createTransaction.payment({
            sender: deployer.addr,
            receiver: appClient.appAddress,
            amount: (20).algo(),
          })
        )
        .initializePetition({
          args: { title, text, duration },
          extraFee: microAlgo(1000),
        })
        .send()

      const stateBefore = await appClient.state.global.getAll()
      const currentEnd = stateBefore.petitionEndRound as bigint

      await expect(
        appClient.send.extendPetition({
          args: { newEndRound: currentEnd - 100n },
        })
      ).rejects.toThrow()
    })
  })

  describe('getPetitionInfo', () => {
    it('should return correct petition info', async () => {
      const { deployer, factory } = await createFundedAccounts()
      const { appClient } = await factory.send.create.createApplication({ args: {} })

      const initResult = await appClient
        .newGroup()
        .addTransaction(
          await algorand.createTransaction.payment({
            sender: deployer.addr,
            receiver: appClient.appAddress,
            amount: (20).algo(),
          })
        )
        .initializePetition({
          args: { title, text, duration },
          extraFee: microAlgo(1000),
        })
        .send()

      const asaId = initResult.returns?.[0] as bigint

      const result = await appClient.send.getPetitionInfo({ args: {} })
      const [startRound, endRound, returnedAsaId, finalized, initialized] = result.return!

      expect(initialized).toBe(true)
      expect(finalized).toBe(false)
      expect(returnedAsaId).toBe(asaId)
      expect(endRound - startRound).toBe(duration)
    })
  })

  describe('Petition finalization', () => {
    it('should reject finalization while petition is active', async () => {
      const { deployer, factory } = await createFundedAccounts()
      const { appClient } = await factory.send.create.createApplication({ args: {} })

      await appClient
        .newGroup()
        .addTransaction(
          await algorand.createTransaction.payment({
            sender: deployer.addr,
            receiver: appClient.appAddress,
            amount: (20).algo(),
          })
        )
        .initializePetition({
          args: { title, text, duration },
          extraFee: microAlgo(1000),
        })
        .send()

      await expect(
        appClient.send.finalizePetition({
          args: {},
          extraFee: microAlgo(2000), // Extra fee for inner transactions
        })
      ).rejects.toThrow()
    })
  })

  describe('Full petition lifecycle', () => {
    it('should complete full petition workflow', async () => {
      const { deployer, signer, factory } = await createFundedAccounts()

      // 1. Create application
      const { appClient, result: createResult } = await factory.send.create.createApplication({
        args: {},
      })
      expect(createResult.appId).toBeGreaterThan(0n)

      // 2. Initialize petition
      const initResult = await appClient
        .newGroup()
        .addTransaction(
          await algorand.createTransaction.payment({
            sender: deployer.addr,
            receiver: appClient.appAddress,
            amount: (20).algo(),
          })
        )
        .initializePetition({
          args: {
            title: 'Save the Rainforest',
            text: new TextEncoder().encode('Protect biodiversity and combat climate change'),
            duration: 25000n,
          },
          extraFee: microAlgo(1000),
        })
        .send()

      const asaId = initResult.returns?.[0] as bigint
      expect(asaId).toBeGreaterThan(0n)

      // 3. Signer signs the petition
      const signerClient = algorand.client.getTypedAppClientById(SignZeroClient, {
        appId: appClient.appId,
        defaultSender: signer.addr,
      })

      await signerClient
        .newGroup()
        .signPetition({ args: {} })
        .addTransaction(
          await algorand.createTransaction.assetTransfer({
            sender: signer.addr,
            receiver: signer.addr,
            assetId: asaId,
            amount: 0n,
          })
        )
        .send()

      // 4. Verify petition info
      const info = await appClient.send.getPetitionInfo({ args: {} })
      const [startRound, endRound, petitionAsaId, finalized, initialized] = info.return!

      expect(initialized).toBe(true)
      expect(finalized).toBe(false)
      expect(petitionAsaId).toBe(asaId)
      expect(endRound).toBeGreaterThan(startRound)

      // 5. Extend petition (author only)
      const newEndRound = endRound + 5000n
      await appClient.send.extendPetition({
        args: { newEndRound },
      })

      const updatedInfo = await appClient.send.getPetitionInfo({ args: {} })
      expect(updatedInfo.return![1]).toBe(newEndRound)

      // Verify signer has the ASA (proving they signed)
      const signerInfo = await algorand.account.getInformation(signer.addr)
      expect(signerInfo.assets?.some((a) => a.assetId === asaId)).toBe(true)
    })
  })
})
