# Algorand Petition dApp - Technical Specification

## Overview
Serverless petition platform using single-deployment smart contracts with current-state eligibility verification and community-driven finalization.

## Architecture

### Core Components
- **Petition Application**: Single AVM contract per petition containing:
  - Box Storage: Petition text content storage
  - petition_asa creation and management
  - Eligibility verification logic (current-state only)
  - Community finalization mechanism
- **Frontend**: Web interface for petition interaction

## Contract State Variables

### Global State
```
petition_start_round: uint64     // Global.Round at deployment
petition_end_round: uint64       // petition_start_round + duration
petition_finalized: bool         // Finalization status
petition_asa_id: uint64         // Created ASA ID
finalizer_reward: uint64        // Excess ALGO for finalizer
```

### Eligibility Flags (Encoded)
```
min_algo_balance: uint64        // Minimum ALGO balance required
required_asa_id: uint64         // Required ASA holdings (0 = disabled)
min_asa_balance: uint64         // Minimum required ASA amount
requires_nfd: bool              // Must own any NFD (domain ASA)
```

## Implementation Flow

### 1. Contract Deployment
- petition_author deploys application with encoded eligibility flags
- Sets `petition_start_round = Global.Round`
- Sets `petition_end_round = petition_start_round + duration`
- Stores petition text in Box storage
- Creates petition_asa with petition title as asset name
- Contract account becomes petition_asa manager
- Excess ALGO stored as `finalizer_reward`

### 2. Petition Signing
```python
@router.method
def sign_petition():
    # Verify petition active
    assert Global.Round <= App.global_get("petition_end_round")
    assert not App.global_get("petition_finalized")
    
    # Current-state eligibility verification
    verify_eligibility(Txn.sender)
    
    # Process opt-in to petition_asa
    # (Inner transaction: asset opt-in)
```

### 3. Eligibility Verification Logic
```python
def verify_eligibility(account: Expr):
    # Check minimum ALGO balance
    if min_algo_balance > 0:
        assert AccountParam.balance(account) >= min_algo_balance
    
    # Check required ASA holdings
    if required_asa_id > 0:
        asset_balance = AssetHolding.balance(account, required_asa_id)
        assert asset_balance >= min_asa_balance
    
    # Check NFD ownership (any domain ASA)
    if requires_nfd:
        # Verify account holds any NFD (domain ASAs have specific format)
        assert has_nfd_ownership(account)
```

### 4. Community Finalization
```python
@router.method
def finalize_petition():
    # Verify finalization conditions
    assert Global.Round > App.global_get("petition_end_round")
    assert not App.global_get("petition_finalized")
    
    # Update petition_asa with final count via asset config
    update_petition_asa_total(valid_signatures)
    
    # Remove manager to make petition_asa immutable
    remove_asa_manager()
    
    # Mark as finalized
    App.global_put("petition_finalized", True)
    
    # Send finalizer reward
    send_finalizer_reward(Txn.sender)
```

## Technical Specifications

### Contract Requirements
- **Global State**: 6 uint64 slots, 2 byte slices
- **Box Storage**: Single box for petition text (key: "petition_text")
- **Inner Transactions**: ASA creation, asset config, payment

### Eligibility Flag Encoding
- Pack multiple flags into global state efficiently
- Use bitwise operations for boolean flags
- Zero values disable optional requirements

### Finalization Incentive
- Contract receives excess ALGO at deployment
- `finalizer_reward` = remaining MBR after required reserves
- Paid to account that successfully calls `finalize_petition()`

## Security Considerations

### Sybil Resistance
- Current-state verification prevents gaming at finalization
- Re-verification ensures eligibility at petition conclusion

### Economic Security
- Small finalizer reward encourages timely finalization
- petition_author funds all operations upfront
- Immutable results via manager removal

### Contract Safety
- Single finalization prevents double-execution
- Round-based timing uses deterministic blockchain state
- No external dependencies or oracle requirements

## Frontend Integration

### Real-time Verification
- Frontend pre-checks eligibility before transaction submission
- Clear feedback for ineligible users

### Petition Discovery
- Index applications by creation time
- Parse petition_asa metadata for titles
- Display active vs finalized status

## Development Phases

1. **Core Contract**: Basic signing, current-state verification
2. **Finalization Logic**: Community finalization with rewards
3. **Frontend**: Complete petition interface
4. **Testing**: Comprehensive eligibility and finalization testing