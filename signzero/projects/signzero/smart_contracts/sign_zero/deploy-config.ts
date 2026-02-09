import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { SignZeroFactory } from '../artifacts/sign_zero/SignZeroClient'

export async function deploy() {
  const algorand = AlgorandClient.fromEnvironment()
  const deployer = await algorand.account.fromEnvironment('DEPLOYER')

  const factory = algorand.client.getTypedAppFactory(SignZeroFactory, {
    defaultSender: deployer.addr,
  })

  console.log('=== SignZero Opinion Deployment ===')
  console.log('Deployer address:', deployer.addr.toString())

  // Step 1: Create the application
  const { appClient, result } = await factory.send.create.createApplication({ args: {} })

  console.log('App created with ID:', result.appId)
  console.log('App address:', appClient.appAddress.toString())

  // Step 2: Initialize the opinion with funding
  const title = 'Test Opinion'
  const text = new TextEncoder().encode(
    'This is a test opinion text for demonstration purposes. Sign Zero!'
  )
  const duration = 25000n // Minimum duration ~1 day

  // Create 32-byte padded opinion type
  const opinionType = new Uint8Array(32)
  new TextEncoder().encodeInto('Petition', opinionType)

  const url = ''

  // Build atomic group: payment + initialize
  const initResult = await appClient.newGroup().addTransaction(
    await algorand.createTransaction.payment({
      sender: deployer.addr,
      receiver: appClient.appAddress,
      amount: (20).algo(),
    })
  ).initialize({
    args: {
      title,
      text,
      duration,
      opinionType,
      url,
    },
    extraFee: (1000).microAlgo(), // Fee for inner ASA creation
  }).send()

  const asaId = initResult.returns?.[0]
  console.log('Opinion initialized!')
  console.log('Created ASA ID:', asaId)

  return { appClient, asaId }
}
