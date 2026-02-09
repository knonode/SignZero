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

      expect(contract.initialized.value).toBe(false)
      expect(contract.finalized.value).toBe(false)
    })
  })

  describe('sign - uninitialized', () => {
    it('should fail if not initialized', () => {
      const contract = ctx.contract.create(SignZero)
      contract.createApplication()

      expect(() => {
        contract.sign()
      }).toThrow('Not initialized')
    })
  })

  describe('extend - uninitialized', () => {
    it('should fail if not initialized', () => {
      const contract = ctx.contract.create(SignZero)
      contract.createApplication()

      expect(() => {
        contract.extend(Uint64(50000))
      }).toThrow('Not initialized')
    })
  })

  describe('finalize - uninitialized', () => {
    it('should fail if not initialized', () => {
      const contract = ctx.contract.create(SignZero)
      contract.createApplication()

      expect(() => {
        contract.finalize()
      }).toThrow('Not initialized')
    })
  })
})
