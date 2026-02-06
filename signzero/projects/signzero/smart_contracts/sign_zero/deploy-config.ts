import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { SignZeroFactory } from '../artifacts/sign_zero/SignZeroClient'

export async function deploy() {
  const algorand = AlgorandClient.fromEnvironment()
  const deployer = await algorand.account.fromEnvironment('DEPLOYER')

  const factory = algorand.client.getTypedAppFactory(SignZeroFactory, {
    defaultSender: deployer.addr,
  })

  console.log('=== SignZero Petition Deployment ===')
  console.log('Deployer address:', deployer.addr.toString())

  // Step 1: Create the application
  const { appClient, result } = await factory.send.create.createApplication({ args: {} })

  console.log('App created with ID:', result.appId)
  console.log('App address:', appClient.appAddress.toString())

  // Step 2: Initialize the petition with funding
  const title = 'Test Petition'
  const text = new TextEncoder().encode(
    'This is a test petition text for demonstration purposes. Sign Zero!'
  )
  const duration = 25000n // Minimum duration ~1 day

  // Build atomic group: payment + initializePetition
  const initResult = await appClient.newGroup().addTransaction(
    await algorand.createTransaction.payment({
      sender: deployer.addr,
      receiver: appClient.appAddress,
      amount: (20).algo(),
    })
  ).initializePetition({
    args: {
      title,
      text,
      duration,
    },
    extraFee: (1000).microAlgo(), // Fee for inner ASA creation
  }).send()

  const asaId = initResult.returns?.[0]
  console.log('Petition initialized!')
  console.log('Created ASA ID:', asaId)

  return { appClient, asaId }
}
