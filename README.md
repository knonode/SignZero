# SignZero

Serverless on-chain petition dApp on Algorand. Sign the petition by opting in to an ASA with supply=0. Ideas don't have ownership, and yet anyone can hold it.

## Problem

Nearly everything we do on-chain carries with it a financial aspect: ownership of assets as a default, voting mechanisms skewed towards whales and economically incentivized participation with weak retention. Social media and web2 instruments on the other hand are prone to abuse: gaming, sybil attacks and botting. Current ways of polling an issue or measuring a sentiment on- or off-chain, or a hybrid approach are all vulnerable to this to a bigger or lesser degree.

## Solution

A simple mechanism that removes the financial aspect of on-chain participation completely. The **only** expense is the 0.1A MBR cost of a single opt-in transaction.

## How It Works

### 1. Petition Creation

The petition author deploys a smart contract with:
- **Petition title** (becomes ASA name, max 32 chars)
- **Petition text** (stored in box storage, max 32KB)
- **Duration** in rounds (minimum 25,000 rounds / \~1 day)
- **Funding** of at least 20 ALGO (covers MBR + finalizer reward)

Upon deployment, the contract mints an ASA with:
- **Name**: petition title
- **Unit name**: "ZERO"
- **Total supply**: 0
- **Creator**: contract account
- **Manager**: contract account (removed at finalization)
- **Reserve**: petition author's address (permanent record)

*A zero-supply ASA cannot be owned by anyone, not even its creator—just as an idea cannot be owned by anyone, yet can be "owned" by a multitude.*

### 2. Signing the Petition

Users sign by submitting an **atomic group** of two transactions:
1. **App call** to `sign_petition()` - contract verifies petition is active
2. **ASA opt-in** - user opts into the petition ASA

The contract validates that both transactions are correctly formed. If the petition has expired, the entire group fails.

The signer now holds 0 units of the petition ASA in their account (with 0.1A MBR).

*Eligibility verification (ASA holdings, ALGO balance, NFD ownership) is performed off-chain via frontend checks using indexer and NFD API. The on-chain signature remains permissionless—anyone can technically opt in, but off-chain analytics can filter and analyze signers.*

### 3. Extending Duration

The petition author can extend the petition duration by calling `extend_petition()` with a new end round. Early closure is not permitted.

### 4. Finalization

After the petition's end round has passed, **anyone** can call `finalize_petition()`. This:
1. Removes the ASA manager (making the ASA immutable)
2. Sends the finalizer reward (remaining ALGO balance) to the caller
3. Marks the petition as finalized

*The lucky finalizer receives the remaining ALGO as a reward for their service.*

### 5. Counting Signatures

Signature counting is done **off-chain** by querying an indexer (e.g., Nodely) for all accounts opted into the petition ASA. This allows for rich analytics: account age, activity history, NFD ownership, etc.

## Funding Breakdown

The 20 ALGO minimum covers:
- Contract account MBR (\~0.1A)
- Box storage MBR (\~0.4A per KB, up to \~12.8A for 32KB)
- ASA creation MBR (0.1A)
- Finalizer reward (remainder)

Authors may fund more than 20 ALGO to increase the finalizer reward.

## Conclusion

A lightweight, non-binding expression of opinions, removed from financial gratification, to help gauge the sentiment of a community, poll an issue, or rally the troops. Users can keep their petition opt-ins as a resume of opinions, or opt-out after the fact.

**Sign Zero.**

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v22+)
- [AlgoKit CLI](https://github.com/algorandfoundation/algokit-cli) (v2.6+)
- [Docker](https://www.docker.com/) (for LocalNet)

Verify your setup:

```bash
node --version    # v22.x or later
algokit --version # 2.6.0 or later
docker --version  # any recent version
```

### Project Structure

```
SignZero/
├── signzero/
│   ├── .algokit.toml                       # Workspace config
│   ├── .github/workflows/                  # CI/CD pipelines
│   └── projects/
│       ├── signzero/                       # Smart contract project
│       │   ├── smart_contracts/
│       │   │   ├── sign_zero/
│       │   │   │   ├── contract.algo.ts    # Contract source
│       │   │   │   └── deploy-config.ts    # Deployment logic
│       │   │   └── artifacts/sign_zero/    # Compiled TEAL + generated client
│       │   └── package.json
│       └── signzero-frontend/              # React frontend
│           ├── src/
│           │   ├── components/             # UI components
│           │   ├── contracts/              # Generated TypeScript client
│           │   └── utils/                  # Network config, NFD helpers
│           └── package.json
```

---

### Running on LocalNet

LocalNet runs a full Algorand network locally via Docker. No real ALGO required.

1. **Start LocalNet**

```bash
algokit localnet start
```

2. **Bootstrap dependencies** (from the workspace root)

```bash
cd signzero
   algokit project bootstrap all
```

3. **Generate the LocalNet environment file**

```bash
cd projects/signzero
   algokit generate env-file -a target_network localnet
```

   This creates `.env.localnet` with the default LocalNet KMD account as the deployer.

4. **Build and deploy the smart contract**

```bash
algokit project run build
   algokit project deploy localnet
```

   Note the **App ID** and **ASA ID** from the deployment output.

5. **Start the frontend**

```bash
cd ../signzero-frontend
   npm install
```

   Ensure `.env` contains:
```
VITE_NETWORK=localnet
```

   Then start the dev server:
```bash
npm run dev
```

6. Open http://localhost:5173 and connect with **KMD wallet** (no password required).

---

### Running on TestNet

TestNet is Algorand's public test network. It uses test ALGO that can be obtained for free.

1. **Set up a TestNet account**
- Create a wallet in [Pera](https://perawallet.app/) or [Defly](https://defly.app/)
- Fund it with at least 50 ALGO via the [TestNet Dispenser](https://bank.testnet.algorand.network/)

2. **Bootstrap dependencies** (if not already done)

```bash
cd signzero
   algokit project bootstrap all
```

3. **Configure environment and deploy**

```bash
cd projects/signzero
```

   Set the deployer mnemonic:
```bash
export DEPLOYER_MNEMONIC="your 25 word mnemonic here"
```

   Build and deploy:
```bash
algokit project run build
   algokit project deploy testnet
```

4. **Start the frontend**

```bash
cd ../signzero-frontend
   npm install
```

   Set the network in `.env`:
```
VITE_NETWORK=testnet
```

   Then start the dev server:
```bash
npm run dev
```

5. Open http://localhost:5173 and connect with **Pera** or **Defly** wallet.

#### CI/CD Deployment to TestNet

The project includes a GitHub Actions workflow (`.github/workflows/signzero-cd.yaml`) for automated TestNet deployment on pushes to `main`. To set it up:

1. Create a GitHub Environment named `contract-testnet`
2. Add the following environment secrets:
- `DEPLOYER_MNEMONIC` - the deployer account mnemonic
- `DISPENSER_MNEMONIC` - a funded account to top up the deployer

---

### Running on MainNet

> **Warning**: MainNet deployments use real ALGO. Ensure your contract is thoroughly tested on LocalNet and TestNet first.

1. **Configure environment and deploy**

```bash
cd signzero/projects/signzero
```

   Set the deployer mnemonic (keep this secure):
```bash
export DEPLOYER_MNEMONIC="your 25 word mnemonic here"
```

   Build and deploy:
```bash
algokit project run build
   algokit project deploy mainnet
```

2. **Build the frontend for production**

```bash
cd ../signzero-frontend
   npm install
```

   Set the network in `.env`:
```
VITE_NETWORK=mainnet
```

   Build and preview:
```bash
npm run build
   npm run preview
```

   For production hosting, deploy the `dist/` directory to your hosting provider of choice.

3. Connect with **Pera** or **Defly** wallet.

---

### Environment Variables

| Variable | Description | Values |
| --- | --- | --- |
| `VITE_NETWORK` | Target network for the frontend | `localnet`, `testnet`, `mainnet` |
| `DEPLOYER_MNEMONIC` | Deployer wallet mnemonic (contract project) | 25-word phrase |
| `DISPENSER_MNEMONIC` | Dispenser account for CI/CD funding | 25-word phrase |

### Running Tests

```bash
cd signzero/projects/signzero

# Run all tests (unit + e2e) with coverage
algokit project run test
```

Unit tests (`contract.algo.spec.ts`) run in-process using the Algorand TypeScript testing framework. End-to-end tests (`contract.e2e.spec.ts`) run against LocalNet, so ensure `algokit localnet start` has been called before running them.

### Network Endpoints

| Network | Algod | Indexer |
| --- | --- | --- |
| LocalNet | `http://localhost:4001` | `http://localhost:8980` |
| TestNet | `https://testnet-api.algonode.cloud` | `https://testnet-idx.algonode.cloud` |
| MainNet | `https://mainnet-api.algonode.cloud` | `https://mainnet-idx.algonode.cloud` |

---

## License

MIT
