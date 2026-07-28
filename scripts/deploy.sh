#!/bin/bash
set -e

echo "=== Deadman Switch - Smart Contract Deployment ==="
echo ""

# Step 1: Build the WASM
echo "[1/4] Building contract WASM..."
cd contract
cargo build --release --target wasm32-unknown-unknown
WASM_PATH="target/wasm32-unknown-unknown/release/deadman_switch.wasm"
echo "  ✅ WASM built: $WASM_PATH"
echo ""

# Step 2: Optimize (optional, if stellar CLI available)
if command -v stellar &> /dev/null; then
  echo "[2/4] Optimizing WASM with Stellar CLI..."
  stellar contract optimize --wasm "$WASM_PATH"
  echo "  ✅ Optimized"
else
  echo "[2/4] Skipping WASM optimization (stellar CLI not found)"
fi
echo ""

# Step 3: Deploy to Testnet
echo "[3/4] Deploying to Stellar Testnet..."
echo "  Network: Test SDF Network ; September 2015"
echo "  RPC: https://soroban-testnet.stellar.org"
echo ""

if [ -z "$STELLAR_SECRET_KEY" ]; then
  echo "  ⚠️  STELLAR_SECRET_KEY not set. To deploy:"
  echo "      export STELLAR_SECRET_KEY=S..."
  echo "      Or use: stellar keys generate deployer --network testnet"
  echo ""
  echo "  Manual deploy command:"
  echo "      stellar contract deploy \\"
  echo "        --wasm $WASM_PATH \\"
  echo "        --network testnet \\"
  echo "        --source deployer"
  exit 0
fi

CONTRACT_ID=$(stellar contract deploy \
  --wasm "$WASM_PATH" \
  --network testnet \
  --source "$STELLAR_SECRET_KEY")

echo "  ✅ Deployed! Contract ID: $CONTRACT_ID"
echo ""

# Step 4: Update frontend config
echo "[4/4] Updating frontend CONTRACT_ID in app.js..."
cd ..
sed -i "s/const CONTRACT_ID.*=.*/const CONTRACT_ID    = \"$CONTRACT_ID\";/" app.js
echo "  ✅ app.js updated with new contract ID"
echo ""

echo "=== Deployment Complete ==="
echo "Contract ID: $CONTRACT_ID"
echo "Open http://127.0.0.1:3000 to use the app"
