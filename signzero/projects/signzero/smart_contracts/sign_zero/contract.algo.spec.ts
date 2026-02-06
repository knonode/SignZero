import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { TestExecutionContext } from '@algorandfoundation/algorand-typescript-testing'
import { Uint64 } from '@algorandfoundation/algorand-typescript'
import { SignZero } from './contract.algo'

describe('SignZero unit tests', () => {
  let ctx: TestExecutionContext

  beforeAll(() => {
    ctx = new TestExecutionContext()
  })

  afterAll(() => {
    ctx.reset()
  })

  describe('createApplication', () => {
    it('should initialize with default state', () => {
      const contract = ctx.contract.create(SignZero)
      contract.createApplication()

      expect(contract.petitionInitialized.value).toBe(false)
      expect(contract.petitionFinalized.value).toBe(false)
    })
  })

  describe('signPetition - uninitialized', () => {
    it('should fail if not initialized', () => {
      const contract = ctx.contract.create(SignZero)
      contract.createApplication()

      expect(() => {
        contract.signPetition()
      }).toThrow('Not initialized')
    })
  })

  describe('extendPetition - uninitialized', () => {
    it('should fail if not initialized', () => {
      const contract = ctx.contract.create(SignZero)
      contract.createApplication()

      expect(() => {
        contract.extendPetition(Uint64(50000))
      }).toThrow('Not initialized')
    })
  })

  describe('finalizePetition - uninitialized', () => {
    it('should fail if not initialized', () => {
      const contract = ctx.contract.create(SignZero)
      contract.createApplication()

      expect(() => {
        contract.finalizePetition()
      }).toThrow('Not initialized')
    })
  })
})
