/**
 * Formats raw Algorand transaction errors into user-friendly messages.
 * Add new patterns here as they're discovered.
 */
export function formatTransactionError(err: unknown): { message: string; details?: string } {
  const raw = err instanceof Error ? err.message : String(err)

  // User cancelled / rejected the transaction in their wallet
  if (/cancel/i.test(raw) || /rejected/i.test(raw) || /user.*deny/i.test(raw) || /user.*refused/i.test(raw)) {
    return { message: 'Transaction was cancelled.' }
  }

  // Overspend — insufficient balance
  if (/overspend/i.test(raw)) {
    return {
      message: "Insufficient balance. Your account doesn't have enough ALGO to cover this transaction.",
      details: raw,
    }
  }

  // Below minimum balance
  if (/below min/i.test(raw)) {
    return {
      message: 'This transaction would bring your account below the minimum required balance.',
      details: raw,
    }
  }

  // Already opted in to the ASA (already signed)
  if (/already opted in/i.test(raw) || /has already been opted in/i.test(raw)) {
    return { message: 'You have already signed this opinion.' }
  }

  // Smart contract logic error with assert
  if (/logic eval error/i.test(raw) && /assert/i.test(raw)) {
    return {
      message: 'The smart contract rejected this transaction. A requirement was not met.',
      details: raw,
    }
  }

  // Generic approval program rejection
  if (/rejected by ApprovalProgram/i.test(raw)) {
    return {
      message: 'Transaction rejected by the smart contract.',
      details: raw,
    }
  }

  // Network connectivity errors
  if (/ECONNREFUSED/i.test(raw) || /network request failed/i.test(raw) || /failed to fetch/i.test(raw)) {
    return {
      message: 'Unable to connect to the Algorand network. Please check your connection and try again.',
      details: raw,
    }
  }

  // Unrecognized error — return a generic message with raw details
  return {
    message: 'Something went wrong. Please try again.',
    details: raw,
  }
}
