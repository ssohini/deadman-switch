// ─── SDK Setup ───────────────────────────────────────────────────────────────
// Stellar SDK is loaded as a UMD bundle via <script> tag → window.StellarSdk
// Freighter wallet extension injects window.freighterApi
const {
  rpc,
  Contract,
  Address,
  TransactionBuilder,
  Transaction,
  Networks,
  Keypair,
  nativeToScVal,
  scValToNative,
  xdr,
} = window.StellarSdk;

// Freighter helper — uses the browser extension's injected global or fallbacks
function getFreighter() {
  const api = window.freighterApi || window.stellar || window.freighter;
  if (!api) throw new Error("Freighter extension not detected. Please install Freighter.");
  return api;
}

// ─── Boot diagnostics ────────────────────────────────────────────────────────
console.log("✅ app.js loaded");
console.log("  StellarSdk:", typeof window.StellarSdk);
console.log("  rpc.Server:", typeof rpc?.Server);
console.log("  Address:", typeof Address);
console.log("  Contract:", typeof Contract);
console.log("  window.freighterApi:", typeof window.freighterApi);
console.log("  window.stellar:", typeof window.stellar);
console.log("  window.freighter:", typeof window.freighter);

// ─── Constants ────────────────────────────────────────────────────────────────
const CONTRACT_ID    = "CATKDFEN5F4ASU3ANJF66Y3JCIE6MZOBHUZIT4DOSG2CK43UQ3X4KDAC";
const NETWORK_PASSPHRASE = Networks.TESTNET; // "Test SDF Network ; September 2015"
const RPC_URL        = "https://soroban-testnet.stellar.org";
// Native XLM Stellar Asset Contract on Testnet
const NATIVE_TOKEN_ID = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

// ─── Application State ────────────────────────────────────────────────────────
let state = {
  status: "INACTIVE",   // 'INACTIVE' | 'ACTIVE' | 'TRIGGERED'
  timerDuration: 0,     // seconds (stored on-chain)
  receiverAddress: "",
  lastCheckIn: null,    // Unix ms derived from chain ledger timestamp
  protocolId: "UNASSIGNED",
  publicKey: "",
};

let walletPublicKey = null;
let triggerInProgress = false;

// ─── DOM Elements ─────────────────────────────────────────────────────────────
const timerInput          = document.getElementById("timer-input");
const receiverInput       = document.getElementById("receiver-input");
const activateBtn         = document.getElementById("activate-btn");
const aliveBtn            = document.getElementById("alive-btn");
const checkBtn            = document.getElementById("check-btn");
const statusDisplay       = document.getElementById("status-display");
const countdownNumber     = document.getElementById("countdown-number");
const lastCheckinDisplay  = document.getElementById("last-checkin-display");
const nextCheckinDisplay  = document.getElementById("next-checkin-display");
const protocolIdDisplay   = document.getElementById("protocol-id-display");
const consoleLogs         = document.getElementById("console-logs");
const clearLogsBtn        = document.getElementById("clear-logs-btn");
const progressBar         = document.getElementById("progress-bar");
const connectWalletBtn    = document.getElementById("connect-wallet-btn");
const walletStatusEl      = document.getElementById("wallet-status");

// ─── Progress Ring ────────────────────────────────────────────────────────────
const RING_RADIUS = 85;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

if (progressBar) {
  progressBar.style.strokeDasharray  = `${RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`;
  progressBar.style.strokeDashoffset = RING_CIRCUMFERENCE;
}

let updateInterval = null;

// ─── Sound Effects ────────────────────────────────────────────────────────────
function playSound(type) {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") return;

    if (type === "activate") {
      const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(440, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.3);
      gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.35);
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.start(); osc.stop(audioCtx.currentTime + 0.35);

    } else if (type === "checkin") {
      const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(1200, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.12);
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.start(); osc.stop(audioCtx.currentTime + 0.12);

    } else if (type === "warning") {
      const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(2000, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.05, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.05);
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.start(); osc.stop(audioCtx.currentTime + 0.05);

    } else if (type === "triggered") {
      const now = audioCtx.currentTime;
      for (let i = 0; i < 3; i++) {
        const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(300, now + i * 0.3);
        osc.frequency.linearRampToValueAtTime(150, now + i * 0.3 + 0.15);
        osc.frequency.linearRampToValueAtTime(300, now + i * 0.3 + 0.3);
        gain.gain.setValueAtTime(0.15, now + i * 0.3);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.3 + 0.28);
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.start(now + i * 0.3); osc.stop(now + i * 0.3 + 0.3);
      }
    }
  } catch (e) {
    console.warn("Audio playback failed:", e);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function generateProtocolId() {
  return `SW-${Math.floor(1000 + Math.random() * 9000)}-OMEGA`;
}

function formatTimestamp(ts) {
  if (!ts) return "NEVER";
  const d = new Date(ts);
  return d.toTimeString().split(" ")[0] + "." + String(d.getMilliseconds()).padStart(3, "0");
}

function appendLog(message, type = "system") {
  const div = document.createElement("div");
  div.className = `log-line ${type}`;
  div.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  consoleLogs.appendChild(div);
  consoleLogs.scrollTop = consoleLogs.scrollHeight;
}

function setProgress(percent, status) {
  if (!progressBar) return;
  progressBar.style.strokeDashoffset = RING_CIRCUMFERENCE - percent * RING_CIRCUMFERENCE;
  if (status === "TRIGGERED") {
    progressBar.style.stroke = "var(--accent-red)";
  } else if (status === "COMPLETED") {
    progressBar.style.stroke = "var(--accent-blue)";
  } else if (status === "ACTIVE") {
    progressBar.style.stroke = percent < 0.25
      ? "var(--accent-red)" : percent < 0.5
      ? "var(--accent-warning)" : "var(--accent-green)";
  } else {
    progressBar.style.stroke = "var(--text-muted)";
  }
}

function saveState() {
  localStorage.setItem("deadman_switch_protocol", JSON.stringify(state));
}

function resetToInactive() {
  state = { status: "INACTIVE", timerDuration: 0, receiverAddress: "", lastCheckIn: null, protocolId: "UNASSIGNED", publicKey: "" };
  walletPublicKey = null;
  saveState();
  clearInterval(updateInterval);
  updateUI();
}

function updateWalletDisplay() {
  if (!walletStatusEl) return;
  if (walletPublicKey) {
    walletStatusEl.textContent = `CONNECTED: ${walletPublicKey.slice(0, 8)}...${walletPublicKey.slice(-4)}`;
    walletStatusEl.classList.add("connected");
  } else {
    walletStatusEl.textContent = "NOT CONNECTED";
    walletStatusEl.classList.remove("connected");
  }
}

// ─── Error Decoding Helpers ──────────────────────────────────────────────────

function getReadableError(errCode) {
  const errors = {
    1: "AlreadyActive: A deadman switch is already active for this owner.",
    2: "TimeoutTooShort: The configured timeout duration must be at least 2 seconds.",
    3: "NotInitialized: No deadman switch has been initialized for this wallet.",
    4: "NotActive: The deadman switch is not currently active (it may have been triggered or expired).",
    5: "WindowNotExceeded: The safety window has not yet been exceeded on-chain (ledger time is still within the timeout).",
    6: "InvalidAmount: The deposit amount must be positive.",
    7: "InsufficientContractBalance: The contract does not have enough on-chain token balance to release.",
  };
  return errors[errCode] || `Unknown Contract Error (Code ${errCode})`;
}

function parseSorobanError(err) {
  const msg = err.message || String(err);

  // 1. Try to find "Error(Contract, <num>)" in the error message
  const contractErrMatch = msg.match(/Error\(Contract,\s*(\d+)\)/i);
  if (contractErrMatch) {
    const code = parseInt(contractErrMatch[1], 10);
    return getReadableError(code);
  }

  // 2. Try to find "Error(WasmVm, InvalidAction)" or "UnreachableCodeReached"
  if (msg.includes("UnreachableCodeReached") || msg.includes("InvalidAction")) {
    return "VM trapped: Unreachable code reached (likely a panic or unwrap in Rust contract).";
  }

  return msg;
}

function decodeTransactionResult(resultXdr) {
  try {
    const txResult = xdr.TransactionResult.fromXDR(resultXdr, "base64");
    const resultResult = txResult.result();
    const codeName = resultResult.switch().name;

    if (codeName === "txFailed" || codeName === "txSuccess") {
      const opResults = resultResult.results();
      if (opResults && opResults.length > 0) {
        const opResult = opResults[0];
        const opCodeName = opResult.switch().name;
        if (opCodeName === "opInner") {
          const opTr = opResult.tr();
          const trCodeName = opTr.switch().name;
          if (trCodeName === "invokeHostFunction") {
            const ihfResult = opTr.invokeHostFunctionResult();
            const ihfCodeName = ihfResult.switch().name;
            if (ihfCodeName === "invokeHostFunctionTrapped") {
              return "Contract execution trapped/failed (e.g. check-in expired, validation failed, or unauthorized call).";
            }
            return `Operation InvokeHostFunction failed: ${ihfCodeName}`;
          }
          return `Operation failed: ${trCodeName}`;
        }
        return `Operation failed with code: ${opCodeName}`;
      }
    }
    return `Transaction failed: ${codeName}`;
  } catch (e) {
    console.warn("decodeTransactionResult failed to parse XDR:", e);
    return "";
  }
}

// ─── Soroban RPC Helpers ──────────────────────────────────────────────────────

/** Get a configured rpc.Server instance */
function getRpcServer() {
  return new rpc.Server(RPC_URL, { allowHttp: false });
}

/**
 * Build, simulate, and prepare a Soroban contract call transaction.
 * Returns the prepared Transaction (footprint injected, ready to sign).
 */
async function buildContractTx(method, args) {
  const server  = getRpcServer();
  const account = await server.getAccount(walletPublicKey);

  const contract   = new Contract(CONTRACT_ID);
  const operation  = contract.call(method, ...args);

  const builtTx = new TransactionBuilder(account, {
    fee: "1000000",               // 0.1 XLM — Soroban needs headroom
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(operation)
    .setTimeout(30)
    .build();

  // prepareTransaction = simulate + inject footprint/auth in one call
  const preparedTx = await server.prepareTransaction(builtTx);
  return { preparedTx, server };
}

/**
 * Sign a prepared transaction with Freighter and submit it.
 * Polls until SUCCESS or FAILED, then returns the result.
 */
async function signAndSubmit(tx, server) {
  appendLog("✍️ Waiting for Freighter signature...", "info");

  const freighter = getFreighter();
  const signResult = await freighter.signTransaction(tx.toXDR(), {
    networkPassphrase: NETWORK_PASSPHRASE,
  });

  const signedXdr = typeof signResult === "string" ? signResult : signResult.signedTxXdr;
  if (!signedXdr) throw new Error("Freighter returned no signed XDR.");

  const signedTx = new Transaction(signedXdr, NETWORK_PASSPHRASE);

  appendLog("🚀 Submitting to Stellar Testnet...", "info");
  const submitResult = await server.sendTransaction(signedTx);

  if (submitResult.status === "ERROR") {
    let errorDetail = "";
    if (submitResult.errorResultXdr) {
      const decoded = decodeTransactionResult(submitResult.errorResultXdr);
      errorDetail = decoded ? `${decoded} (XDR: ${submitResult.errorResultXdr})` : `XDR: ${submitResult.errorResultXdr}`;
    } else {
      errorDetail = `Hash: ${submitResult.hash}`;
    }
    throw new Error(`Submission failed: ${submitResult.status}. ${errorDetail}`);
  }

  appendLog(`⏳ Confirming (hash: ${submitResult.hash.slice(0, 16)}...)`, "info");

  // Poll up to ~30 s
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 1500));
    const result = await server.getTransaction(submitResult.hash);
    if (result.status === rpc.Api.GetTransactionStatus.SUCCESS) return result;
    if (result.status === rpc.Api.GetTransactionStatus.FAILED) {
      let errorDetail = "";
      if (result.resultXdr) {
        const decoded = decodeTransactionResult(result.resultXdr);
        errorDetail = decoded ? `${decoded}` : `XDR: ${result.resultXdr}`;
      }
      throw new Error(`Transaction failed on ledger. ${errorDetail}`);
    }
    // NOT_FOUND → still pending, keep polling
  }

  throw new Error(`Confirmation timed out. Hash: ${submitResult.hash}`);
}

/**
 * Simulate get_switch (read-only) and decode the returned SwitchState.
 * Returns null if no switch is initialised for this owner.
 */
async function readContractState(ownerAddress) {
  const server = getRpcServer();

  let account;
  try {
    account = await server.getAccount(ownerAddress);
  } catch (e) {
    throw new Error("Account not found. Fund your Testnet wallet first: https://laboratory.stellar.org/#account-creator");
  }

  const contract   = new Contract(CONTRACT_ID);
  const ownerScVal = Address.fromString(ownerAddress).toScVal();
  const operation  = contract.call("get_switch", ownerScVal);

  const tx = new TransactionBuilder(account, {
    fee: "1000000",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(operation)
    .setTimeout(30)
    .build();

  const simResult = await server.simulateTransaction(tx);

  if (rpc.Api.isSimulationError(simResult)) {
    // Contract panics when switch doesn't exist — treat as no switch
    return null;
  }

  const retval = simResult.result?.retval;
  if (!retval) return null;

  // Option<SwitchState>: scvVoid = None
  try {
    if (retval.switch().name === "scvVoid") return null;
  } catch (_) { /* not void, continue */ }

  try {
    return scValToNative(retval); // { beneficiary, timeout, last_check_in, active, balance }
  } catch (e) {
    console.warn("scValToNative failed:", e);
    return null;
  }
}

// ─── Wallet Connection ────────────────────────────────────────────────────────
async function connectWallet() {
  console.log("Connecting wallet...");
  try {
    const freighter = getFreighter();

    // Check if extension is connected
    const isConn   = await freighter.isConnected();
    const connected = typeof isConn === "object" ? isConn.isConnected : isConn;
    if (!connected) {
      appendLog("❌ Freighter is not installed or not connected.", "danger");
      return;
    }

    await freighter.requestAccess();

    const addrResult = await freighter.getAddress();
    const address    = typeof addrResult === "object" ? addrResult.address : addrResult;
    if (!address) throw new Error("No address returned from Freighter.");

    walletPublicKey  = address;
    state.publicKey  = address;
    saveState();
    updateWalletDisplay();
    appendLog(`✅ Wallet connected: ${address}`, "success");

    appendLog("🔍 Reading on-chain switch state...", "info");
    await syncChainState();

  } catch (e) {
    appendLog(`❌ Wallet connection failed: ${e.message}`, "danger");
    console.error("connectWallet error:", e);
  }
}

window.connectWallet = connectWallet;

// ─── Sync Chain State ─────────────────────────────────────────────────────────
async function syncChainState() {
  if (!walletPublicKey) return;

  try {
    const chainState = await readContractState(walletPublicKey);

    if (!chainState) {
      appendLog("ℹ️ No on-chain switch found. Configure and activate below.", "system");
      state.status        = "INACTIVE";
      state.timerDuration = 0;
      state.receiverAddress = "";
      state.lastCheckIn   = null;
      state.protocolId    = "UNASSIGNED";
      saveState();
      updateUI();
      return;
    }

    // chainState fields come back as native JS types after scValToNative
    const timeoutSecs    = Number(chainState.timeout ?? 0);
    const lastCheckInSec = Number(chainState.last_check_in ?? 0);
    const isActive       = Boolean(chainState.active);
    const beneficiary    = String(chainState.beneficiary ?? "");

    const lastCheckInMs  = lastCheckInSec * 1000;     // ledger ts → ms
    const expiresAtMs    = lastCheckInMs + timeoutSecs * 1000;
    const now            = Date.now();

    if (!isActive || now > expiresAtMs) {
      state.status = "TRIGGERED";
    } else {
      state.status = "ACTIVE";
    }

    state.timerDuration    = timeoutSecs;
    state.receiverAddress  = beneficiary;
    state.lastCheckIn      = lastCheckInMs;
    if (state.protocolId === "UNASSIGNED") state.protocolId = generateProtocolId();

    saveState();
    updateUI();

    if (state.status === "ACTIVE") {
      startInterval();
      appendLog(`✅ On-chain switch loaded — ACTIVE. Timeout: ${timeoutSecs}s`, "success");
    } else {
      appendLog("⚠️ On-chain switch is TRIGGERED or EXPIRED.", "warning");
    }

  } catch (e) {
    appendLog(`⚠️ Could not read on-chain state: ${parseSorobanError(e)}`, "warning");
    console.error("syncChainState error:", e);
  }
}

/**
 * Returns the current Stellar ledger close timestamp in SECONDS (Unix).
 * This is what env.ledger().timestamp() returns inside contracts.
 */
async function getLedgerTimestamp() {
  const server = getRpcServer();
  const ledger = await server.getLatestLedger();
  return Number(ledger.closeTime); // already seconds
}

// ─── Activate Switch ──────────────────────────────────────────────────────────
async function activateSwitch() {
  const duration = parseInt(timerInput.value, 10);
  const receiver = receiverInput.value.trim();

  if (isNaN(duration) || duration < 2) {
    appendLog("Error: Timer duration must be at least 2 seconds.", "danger");
    return;
  }
  if (!receiver) {
    appendLog("Error: Receiver address must be configured.", "danger");
    return;
  }

  // Validate receiver is a real Stellar G... address
  try { Keypair.fromPublicKey(receiver); }
  catch (_) {
    appendLog("❌ Receiver must be a valid Stellar address (G...).", "danger");
    return;
  }

  if (!walletPublicKey) {
    appendLog("❌ Connect your Freighter wallet first.", "danger");
    return;
  }

  appendLog("🔐 Initializing Deadman Switch on Stellar Testnet...", "info");
  activateBtn.disabled = true;

  try {
    const ownerScVal       = Address.fromString(walletPublicKey).toScVal();
    const beneficiaryScVal = Address.fromString(receiver).toScVal();
    const timeoutScVal     = nativeToScVal(BigInt(duration), { type: "u64" });

    const { preparedTx, server } = await buildContractTx("init_switch", [
      ownerScVal, beneficiaryScVal, timeoutScVal,
    ]);

    await signAndSubmit(preparedTx, server);

    // Re-read chain state to get the ACTUAL on-chain ledger timestamp
    // (not Date.now() which is browser time and may drift from ledger time)
    appendLog("🔍 Reading on-chain ledger timestamp...", "info");
    const chainState = await readContractState(walletPublicKey);
    if (chainState) {
      const lastCheckInSec = Number(chainState.last_check_in ?? 0);
      state.lastCheckIn    = lastCheckInSec * 1000; // ledger seconds → ms
      const currentLedgerTs = await getLedgerTimestamp();
      const expiresAt = lastCheckInSec + duration;
      appendLog(`📋 On-chain last_check_in: ${lastCheckInSec}s (Unix) | timeout: ${duration}s | expires at ledger: ${expiresAt}s`, "system");
      appendLog(`📋 Current ledger time: ${currentLedgerTs}s | seconds until expiry: ${expiresAt - currentLedgerTs}s`, "system");
    } else {
      // Fallback: use ledger time instead of Date.now()
      const currentLedgerTs = await getLedgerTimestamp();
      state.lastCheckIn = currentLedgerTs * 1000;
    }

    state.status         = "ACTIVE";
    state.timerDuration  = duration;
    state.receiverAddress = receiver;
    if (!state.protocolId || state.protocolId === "UNASSIGNED") state.protocolId = generateProtocolId();
    saveState();

    playSound("activate");
    appendLog(`✅ Switch activated on-chain! ID: ${state.protocolId}`, "success");
    appendLog(`🕒 Timeout: ${duration}s | Beneficiary: ${receiver}`, "info");

    updateUI();
    startInterval();

  } catch (e) {
    appendLog(`❌ Activation failed: ${parseSorobanError(e)}`, "danger");
    console.error("activateSwitch error:", e);
    activateBtn.disabled = false;
  }
}

// ─── Check-In ─────────────────────────────────────────────────────────────────
async function checkIn() {
  if (state.status !== "ACTIVE") {
    appendLog("Action denied: Switch is not active.", "warning");
    return;
  }
  if (!walletPublicKey) {
    appendLog("❌ Connect your Freighter wallet first.", "danger");
    return;
  }

  appendLog("💓 Sending check-in heartbeat to blockchain...", "info");
  aliveBtn.disabled = true;

  try {
    const ownerScVal = Address.fromString(walletPublicKey).toScVal();
    const { preparedTx, server } = await buildContractTx("check_in", [ownerScVal]);
    await signAndSubmit(preparedTx, server);

    // Re-read chain state to get the ACTUAL on-chain ledger timestamp after check-in
    const chainState = await readContractState(walletPublicKey);
    if (chainState) {
      const lastCheckInSec = Number(chainState.last_check_in ?? 0);
      state.lastCheckIn    = lastCheckInSec * 1000;
      const currentLedgerTs = await getLedgerTimestamp();
      const expiresAt = lastCheckInSec + state.timerDuration;
      appendLog(`📋 Check-in stored: last_check_in=${lastCheckInSec}s | timeout=${state.timerDuration}s | expires at ledger=${expiresAt}s`, "system");
      appendLog(`📋 Current ledger: ${currentLedgerTs}s | seconds until expiry: ${expiresAt - currentLedgerTs}s`, "system");
    } else {
      const currentLedgerTs = await getLedgerTimestamp();
      state.lastCheckIn = currentLedgerTs * 1000;
    }
    saveState();

    playSound("checkin");
    appendLog(`✅ Check-in confirmed on-chain! Reset for another ${state.timerDuration}s.`, "success");
    updateUI();

  } catch (e) {
    appendLog(`❌ Check-in failed: ${parseSorobanError(e)}`, "danger");
    console.error("checkIn error:", e);
  } finally {
    aliveBtn.disabled = (state.status !== "ACTIVE");
  }
}

// ─── Check Status ─────────────────────────────────────────────────────────────
async function checkStatus() {
  appendLog("🔍 Executing on-chain status diagnostics...", "system");

  if (!walletPublicKey) {
    appendLog("ℹ️ Connect wallet to check on-chain state.", "warning");
    return;
  }

  try {
    // Fetch current ledger timestamp FIRST for accurate diagnostics
    const currentLedgerTs = await getLedgerTimestamp();
    appendLog(`⏱️ Current ledger timestamp: ${currentLedgerTs}s (${new Date(currentLedgerTs * 1000).toUTCString()})`, "system");

    const chainState = await readContractState(walletPublicKey);

    if (!chainState) {
      appendLog("ℹ️ On-chain: INACTIVE — no switch found for this wallet.", "system");
      state.status = "INACTIVE";
      saveState();
      updateUI();
      return;
    }

    const lastCheckInSec  = Number(chainState.last_check_in ?? 0);
    const timeoutSecs     = Number(chainState.timeout ?? 0);
    const isActive        = Boolean(chainState.active);
    const beneficiary     = String(chainState.beneficiary ?? "");
    const expiresAtSec    = lastCheckInSec + timeoutSecs;
    const secsRemaining   = expiresAtSec - currentLedgerTs;
    const expired         = currentLedgerTs >= expiresAtSec;

    appendLog("─────── On-Chain Switch Diagnostics ───────", "system");
    appendLog(`  Owner:          ${walletPublicKey}`, "system");
    appendLog(`  Beneficiary:    ${beneficiary}`, "system");
    appendLog(`  Active:         ${isActive}`, "system");
    appendLog(`  Timeout:        ${timeoutSecs}s`, "system");
    appendLog(`  last_check_in:  ${lastCheckInSec}s (${new Date(lastCheckInSec * 1000).toUTCString()})`, "system");
    appendLog(`  Expires at:     ${expiresAtSec}s (${new Date(expiresAtSec * 1000).toUTCString()})`, "system");
    appendLog(`  Current ledger: ${currentLedgerTs}s`, "system");
    appendLog(`  Seconds left:   ${secsRemaining}s (${expired ? "⚠️ EXPIRED on ledger" : "✅ Active"})`, expired ? "danger" : "success");
    appendLog("───────────────────────────────────────────", "system");

    // Update local state from chain
    state.lastCheckIn    = lastCheckInSec * 1000;
    state.timerDuration  = timeoutSecs;
    state.receiverAddress = beneficiary;
    state.status = (!isActive || expired) ? "TRIGGERED" : "ACTIVE";
    saveState();
    updateUI();

    if (state.status === "ACTIVE") {
      appendLog(`✅ Switch is ACTIVE — ${secsRemaining}s until ledger expiry.`, "success");
    } else {
      appendLog("🚨 Switch is EXPIRED or TRIGGERED on ledger.", "danger");
    }

  } catch (e) {
    appendLog(`❌ Status check failed: ${e.message}`, "danger");
    console.error("checkStatus error:", e);
  }
}

// ─── Emergency Trigger ────────────────────────────────────────────────────────
async function triggerEmergency() {
  if (!walletPublicKey) {
    appendLog("❌ No wallet connected. Connect Freighter first.", "danger");
    return;
  }

  if (triggerInProgress) {
    appendLog("ℹ️ Emergency trigger is already in progress. Blocked duplicate call.", "warning");
    return;
  }

  triggerInProgress = true;
  clearInterval(updateInterval); // Stop timer interval immediately to prevent any concurrent checks

  appendLog("🚨 Initiating on-chain emergency trigger...", "warning");

  try {
    const ownerScVal = Address.fromString(walletPublicKey).toScVal();
    const tokenScVal = Address.fromString(NATIVE_TOKEN_ID).toScVal();

    const { preparedTx, server } = await buildContractTx("trigger", [ownerScVal, tokenScVal]);
    await signAndSubmit(preparedTx, server);

    state.status = "TRIGGERED";
    saveState();
    clearInterval(updateInterval); // Stop polling after successful trigger

    playSound("triggered");
    appendLog("🚨 EMERGENCY TRIGGER EXECUTED ON-CHAIN!", "danger");
    appendLog(`📨 Funds released to: ${state.receiverAddress}`, "danger");

  } catch (e) {
    appendLog(`❌ Trigger failed: ${parseSorobanError(e)}`, "danger");
    console.error("triggerEmergency error:", e);
    // Restore status to TRIGGERED so user can manually retry if they rejected the signature
    state.status = "TRIGGERED";
    saveState();
  } finally {
    triggerInProgress = false;
    updateUI();
  }
}

window.triggerStellarTransaction = triggerEmergency;

// ─── State Evaluation (local timer → auto-trigger on-chain when expired) ──────
// NOTE: We add an EXTRA_TRIGGER_BUFFER_MS of buffer after the local countdown
// reaches 0 before attempting on-chain trigger. This is necessary because the
// Stellar ledger clock updates every ~5s and may lag behind browser Date.now().
// The contract checks env.ledger().timestamp() >= last_check_in + timeout,
// so we must wait for the ledger to actually close past the expiry point.
const EXTRA_TRIGGER_BUFFER_MS = 8000; // 8 seconds extra buffer after countdown = 0

async function evaluateState() {
  // Ensure evaluateState() does NOT call triggerEmergency() if triggerInProgress is true or switch is already triggered
  if (state.status !== "ACTIVE") return;
  if (triggerInProgress || state.status === "TRIGGERED") return;

  // Use local time as a first-pass check — only proceed if we're past
  // (lastCheckIn + timeout + buffer)
  const now = Date.now();
  const localExpiryMs = state.lastCheckIn + state.timerDuration * 1000;
  if (now < localExpiryMs + EXTRA_TRIGGER_BUFFER_MS) return;

  // Immediately stop polling before calling any async/on-chain checks
  // to prevent overlapping ticks from firing while we await ledger time
  clearInterval(updateInterval);

  // Secondary check: confirm the LEDGER has also passed expiry
  try {
    const currentLedgerTs = await getLedgerTimestamp();
    const lastCheckInSec  = state.lastCheckIn / 1000;
    const expiresAtSec    = lastCheckInSec + state.timerDuration;
    const ledgerExpired   = currentLedgerTs >= expiresAtSec;

    appendLog(`🔎 Evaluating trigger: ledger=${currentLedgerTs}s, expires=${expiresAtSec}s, expired=${ledgerExpired}`, "system");

    if (!ledgerExpired) {
      // Ledger hasn't caught up yet — wait and restart interval
      appendLog(`⏳ Browser countdown ended but ledger not yet expired (${expiresAtSec - currentLedgerTs}s remaining on ledger). Waiting...`, "warning");
      startInterval();
      return;
    }
  } catch (e) {
    console.warn("evaluateState: could not fetch ledger timestamp:", e);
    // Restart interval so we can retry next cycle
    startInterval();
    return;
  }

  // Re-verify flags before proceeding
  if (state.status !== "ACTIVE" || triggerInProgress || state.status === "TRIGGERED") return;

  state.status = "TRIGGERED";
  saveState();
  clearInterval(updateInterval); // Stop polling immediately

  playSound("triggered");
  appendLog("🚨 Safety window exceeded (confirmed on ledger) — initiating on-chain trigger...", "danger");
  
  await triggerEmergency();
}

// ─── Countdown Loop ───────────────────────────────────────────────────────────
function startInterval() {
  clearInterval(updateInterval);
  let lastSecondLogged = -1;

  updateInterval = setInterval(() => {
    if (state.status !== "ACTIVE") { clearInterval(updateInterval); return; }

    const now         = Date.now();
    const expiryTime  = state.lastCheckIn + state.timerDuration * 1000;
    const msRemaining = expiryTime - now;

    if (msRemaining <= 0) { evaluateState(); updateUI(); return; }

    const secondsRemaining = Math.max(0, Math.ceil(msRemaining / 1000));
    countdownNumber.textContent = secondsRemaining;
    setProgress(Math.max(0, msRemaining / (state.timerDuration * 1000)), "ACTIVE");

    if (secondsRemaining <= 10 && secondsRemaining !== lastSecondLogged) {
      lastSecondLogged = secondsRemaining;
      playSound("warning");
      appendLog(`⚠️ Warning: trigger in ${secondsRemaining}s...`, "warning");
    }
  }, 100);
}

// ─── UI Update ────────────────────────────────────────────────────────────────
function updateUI() {
  statusDisplay.textContent = state.status;
  statusDisplay.className   = `status-badge state-${state.status.toLowerCase()}`;
  protocolIdDisplay.textContent = `PROTOCOL-ID: ${state.protocolId}`;

  timerInput.value    = state.timerDuration > 0 ? state.timerDuration : "";
  receiverInput.value = state.receiverAddress;

  if (state.lastCheckIn) {
    lastCheckinDisplay.textContent = formatTimestamp(state.lastCheckIn);
    nextCheckinDisplay.textContent = formatTimestamp(state.lastCheckIn + state.timerDuration * 1000);
  } else {
    lastCheckinDisplay.textContent = "NEVER";
    nextCheckinDisplay.textContent = "N/A";
  }

  if (state.status === "ACTIVE") {
    timerInput.disabled    = receiverInput.disabled = true;
    activateBtn.disabled   = true;
    activateBtn.classList.add("btn-disabled");
    aliveBtn.disabled      = triggerInProgress;
    if (triggerInProgress) {
      aliveBtn.classList.add("btn-disabled");
    } else {
      aliveBtn.classList.remove("btn-disabled");
    }
    checkBtn.disabled      = triggerInProgress;
    if (triggerInProgress) {
      checkBtn.classList.add("btn-disabled");
    } else {
      checkBtn.classList.remove("btn-disabled");
    }
    const msRemaining = (state.lastCheckIn + state.timerDuration * 1000) - Date.now();
    setProgress(Math.max(0, msRemaining / (state.timerDuration * 1000)), "ACTIVE");

  } else if (state.status === "TRIGGERED") {
    timerInput.disabled    = receiverInput.disabled = triggerInProgress;
    activateBtn.disabled   = triggerInProgress;
    if (triggerInProgress) {
      activateBtn.classList.add("btn-disabled");
    } else {
      activateBtn.classList.remove("btn-disabled");
    }
    aliveBtn.disabled      = true;
    aliveBtn.classList.add("btn-disabled");
    checkBtn.disabled      = triggerInProgress;
    if (triggerInProgress) {
      checkBtn.classList.add("btn-disabled");
    } else {
      checkBtn.classList.remove("btn-disabled");
    }
    countdownNumber.textContent    = "00";
    nextCheckinDisplay.textContent = "EXPIRED";
    setProgress(0, "TRIGGERED");

  } else {
    timerInput.disabled    = receiverInput.disabled = false;
    activateBtn.disabled   = false;
    activateBtn.classList.remove("btn-disabled");
    aliveBtn.disabled      = true;
    aliveBtn.classList.add("btn-disabled");
    checkBtn.disabled      = false;
    checkBtn.classList.remove("btn-disabled");
    countdownNumber.textContent = "--";
    setProgress(1, "INACTIVE");
  }

  updateWalletDisplay();
}

// ─── Event Listeners ──────────────────────────────────────────────────────────
document.getElementById("switch-config-form").addEventListener("submit", e => {
  e.preventDefault();
  activateSwitch();
});

aliveBtn.addEventListener("click", checkIn);
checkBtn.addEventListener("click", checkStatus);
connectWalletBtn.addEventListener("click", connectWallet);

clearLogsBtn.addEventListener("click", () => {
  consoleLogs.innerHTML = `<div class="log-line system">[LOGS CLEARED] State: ${state.status}</div>`;
});

// ─── Init ─────────────────────────────────────────────────────────────────────
function loadState() {
  const stored = localStorage.getItem("deadman_switch_protocol");
  if (stored) {
    try {
      state = JSON.parse(stored);
      appendLog(`Restored local state: ${state.status}`, "system");

      if (state.publicKey) {
        walletPublicKey = state.publicKey;
        updateWalletDisplay();
        // Sync with chain asynchronously
        syncChainState().catch(e => appendLog(`⚠️ Chain sync: ${e.message}`, "warning"));
      }

      if (state.status === "ACTIVE") {
        evaluateState();                           // check if expired while offline
        if (state.status === "ACTIVE") startInterval();
      }

      updateUI();
    } catch (e) {
      appendLog("Failed to restore state. Starting fresh.", "warning");
      resetToInactive();
    }
  } else {
    resetToInactive();
    appendLog("[SYSTEM INITIALIZED] Connect wallet and configure your switch.", "system");
  }
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", loadState);
} else {
  loadState();
}
