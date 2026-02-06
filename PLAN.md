# SignZero Implementation Plan

## Phase 1: Contract Development

### 1.1 Project Setup
- `algokit init -n signzero -t typescript --answer preset "Production" --defaults`
- Configure project structure
- Verify localnet works

### 1.2 Contract Implementation (Puya-TS)

**File:** `contracts/SignZero.algo.ts`

**Global state:**
- `petition_start_round: uint64`
- `petition_end_round: uint64`
- `petition_finalized: bool`
- `petition_asa_id: uint64`

**Box:** `petition_text` (max 32KB)

**Methods:**

1. `create(title: string, text: bytes, duration: uint64)`
   - Verify payment >= 20 ALGO
   - Verify duration >= 25,000
   - Verify title <= 32 chars
   - Verify text <= 32KB
   - Set start/end rounds
   - Create box with text
   - Inner txn: create ASA (name=title, unit="ZERO", supply=0, manager=app, reserve=sender)
   - Store ASA ID

2. `sign_petition()` — validates atomic group
   - Assert round <= end_round
   - Assert not finalized
   - Assert group_size == 2
   - Assert Gtxn[1].type == AssetTransfer
   - Assert Gtxn[1].xfer_asset == petition_asa_id
   - Assert Gtxn[1].amount == 0
   - Assert Gtxn[1].sender == Txn.sender
   - Assert Gtxn[1].receiver == Txn.sender

3. `extend_petition(new_end_round: uint64)`
   - Assert sender == ASA.reserve
   - Assert not finalized
   - Assert new_end > current end
   - Update end_round

4. `finalize_petition()`
   - Assert round > end_round
   - Assert not finalized
   - Inner txn: acfg to remove manager
   - Set finalized = true
   - Inner txn: pay remaining balance to sender

### 1.3 Contract Testing
- Test create with valid/invalid params
- Test sign with valid atomic group (app call + opt-in)
- Test sign with invalid group (wrong ASA, wrong sender)
- Test sign after expiry (should fail)
- Test sign without group (should fail)
- Test extend by author
- Test extend by non-author (should fail)
- Test finalize after expiry
- Test finalize before expiry (should fail)
- Test double finalize (should fail)

### 1.4 Deploy to Testnet
- Configure testnet in `.algokit.toml`
- Fund deployer account
- Deploy sample petition
- Verify via explorer

---

## Phase 2: Frontend Development

### 2.1 Project Setup
- `algokit init -n signzero-frontend -t react` OR add to existing project
- Install deps: `@txnlab/use-wallet-react`, `algosdk`, `@algorandfoundation/algokit-utils`
- Generate typed client from ARC-56 spec
- Configure wallet providers (Pera, Defly)

### 2.2 Core Components

**WalletProvider setup:**
- Configure supported wallets
- Network selection (localnet/testnet)

**Pages:**

1. **Home (`/`)**
   - List petitions (query indexer for SignZero apps)
   - Filter: active/finalized
   - Search by title
   - Link to petition detail

2. **Create Petition (`/create`)**
   - Form: title, text, duration
   - Duration picker (days → rounds conversion)
   - Funding amount (min 20 ALGO)
   - Deploy button → create app call
   - Success: redirect to petition detail

3. **Petition Detail (`/petition/:appId`)**
   - Display title, text, author (from ASA reserve)
   - Status: active/expired/finalized
   - Time remaining (rounds → human readable)
   - Signature count (indexer query)
   - Sign button (if active + connected)
   - Finalize button (if expired + not finalized)
   - Extend button (if author + not finalized)

4. **My Signatures (`/my-signatures`)**
   - Query user's ASA holdings where unit="ZERO"
   - List signed petitions
   - Link to each petition

### 2.3 Services

**AlgorandService:**
- Indexer queries (petition discovery, signature count)
- App client instantiation

**PetitionService:**
- `createPetition(title, text, duration, funding)` — deploy app
- `signPetition(appId, asaId)` — build atomic group (app call + ASA opt-in)
- `extendPetition(appId, newEndRound)` — author only
- `finalizePetition(appId)` — anyone after expiry
- `getPetitionDetails(appId)` — fetch app state + ASA info
- `getSignatureCount(asaId)` — indexer query for opt-in count
- `getUserSignatures(address)` — user's ZERO ASA holdings

### 2.4 UI/Styling
- Tailwind CSS setup
- Responsive layout
- Loading states
- Error handling/toasts
- Transaction confirmation modals

---

## Phase 3: Integration & Testing

### 3.1 Local Testing
- Start localnet
- Deploy contract
- Test all frontend flows
- Test wallet connect/disconnect
- Test error cases

### 3.2 Testnet Testing
- Deploy to testnet
- Configure frontend for testnet
- End-to-end testing
- Multi-wallet testing

---

## Task Breakdown (Estimated)

| Task | Priority |
|------|----------|
| 1.1 Project setup | P0 |
| 1.2 Contract implementation | P0 |
| 1.3 Contract testing | P0 |
| 1.4 Testnet deploy | P1 |
| 2.1 Frontend setup | P0 |
| 2.2 Core pages | P0 |
| 2.3 Services | P0 |
| 2.4 Styling | P1 |
| 3.1 Local testing | P0 |
| 3.2 Testnet testing | P1 |

---

## Resolved Decisions

- **Petition discovery**: Social media + website links (no indexer-based discovery)
- **Signing mechanism**: Atomic group (app call + ASA opt-in) — on-chain round enforcement
- **Indexer**: Nodely (60 calls/sec, no API key required)
