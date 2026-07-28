/**
 * Frontend Smoke Tests for Deadman Switch Protocol
 * 
 * These tests validate the core helper functions, state management,
 * and DOM structure expectations without requiring a browser environment.
 * Run with: npm test (or node tests/frontend.test.js)
 */

// ─── Minimal Test Runner ────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures = [];

function describe(name, fn) {
  console.log(`\n  📦 ${name}`);
  fn();
}

function it(name, fn) {
  try {
    fn();
    passed++;
    console.log(`    ✅ ${name}`);
  } catch (e) {
    failed++;
    failures.push({ name, error: e.message });
    console.log(`    ❌ ${name}`);
    console.log(`       → ${e.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || "Assertion failed");
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected "${expected}", got "${actual}"`);
  }
}

function assertIncludes(haystack, needle, message) {
  if (!haystack.includes(needle)) {
    throw new Error(message || `Expected "${haystack}" to include "${needle}"`);
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────────
const fs = require("fs");
const path = require("path");

const projectRoot = path.join(__dirname, "..");

console.log("🧪 Deadman Switch — Frontend Smoke Tests\n");
console.log("─".repeat(50));

// ─── 1. File Structure Tests ─────────────────────────────────────────────────
describe("Project Structure", () => {
  const requiredFiles = [
    "index.html",
    "app.js",
    "style.css",
    "package.json",
    ".gitignore",
    "README.md",
    "contract/src/lib.rs",
    "contract/src/test.rs",
    "contract/Cargo.toml",
    ".github/workflows/ci.yml",
  ];

  for (const file of requiredFiles) {
    it(`${file} exists`, () => {
      const filePath = path.join(projectRoot, file);
      assert(fs.existsSync(filePath), `File not found: ${file}`);
    });
  }
});

// ─── 2. HTML Structure Tests ─────────────────────────────────────────────────
describe("HTML Structure", () => {
  const html = fs.readFileSync(path.join(projectRoot, "index.html"), "utf8");

  it("has viewport meta tag for mobile responsiveness", () => {
    assertIncludes(html, 'name="viewport"');
    assertIncludes(html, "width=device-width");
  });

  it("has meta description for SEO", () => {
    assertIncludes(html, 'name="description"');
  });

  it("has a single h1 heading", () => {
    const h1Count = (html.match(/<h1>/gi) || []).length;
    assertEqual(h1Count, 1, `Expected 1 <h1>, found ${h1Count}`);
  });

  it("has semantic form element", () => {
    assertIncludes(html, '<form id="switch-config-form"');
  });

  it("includes Freighter API script", () => {
    assertIncludes(html, "freighter-api");
  });

  it("includes Stellar SDK script", () => {
    assertIncludes(html, "stellar-sdk");
  });

  it("has connect wallet button", () => {
    assertIncludes(html, 'id="connect-wallet-btn"');
  });

  it("has activate button", () => {
    assertIncludes(html, 'id="activate-btn"');
  });

  it("has alive (check-in) button", () => {
    assertIncludes(html, 'id="alive-btn"');
  });

  it("has check status button", () => {
    assertIncludes(html, 'id="check-btn"');
  });

  it("has countdown display", () => {
    assertIncludes(html, 'id="countdown-number"');
  });

  it("has console logs panel", () => {
    assertIncludes(html, 'id="console-logs"');
  });
});

// ─── 3. CSS Structure Tests ──────────────────────────────────────────────────
describe("CSS Features", () => {
  const css = fs.readFileSync(path.join(projectRoot, "style.css"), "utf8");

  it("uses CSS custom properties (design tokens)", () => {
    assertIncludes(css, "--bg-color");
    assertIncludes(css, "--accent-blue");
    assertIncludes(css, "--accent-green");
    assertIncludes(css, "--accent-red");
  });

  it("has mobile breakpoint @media (max-width: 768px)", () => {
    assertIncludes(css, "@media (max-width: 768px)");
  });

  it("has small mobile breakpoint @media (max-width: 480px)", () => {
    assertIncludes(css, "@media (max-width: 480px)");
  });

  it("has glassmorphism panel styles", () => {
    assertIncludes(css, "backdrop-filter");
  });

  it("has btn-loading animation class", () => {
    assertIncludes(css, ".btn-loading");
    assertIncludes(css, "btn-pulse");
  });

  it("has btn-disabled class", () => {
    assertIncludes(css, ".btn-disabled");
  });

  it("has status badge states", () => {
    assertIncludes(css, "state-active");
    assertIncludes(css, "state-inactive");
    assertIncludes(css, "state-triggered");
  });
});

// ─── 4. JavaScript Logic Tests ───────────────────────────────────────────────
describe("JavaScript Logic", () => {
  const js = fs.readFileSync(path.join(projectRoot, "app.js"), "utf8");

  it("defines CONTRACT_ID constant", () => {
    assertIncludes(js, "const CONTRACT_ID");
  });

  it("defines NETWORK_PASSPHRASE constant", () => {
    assertIncludes(js, "const NETWORK_PASSPHRASE");
  });

  it("defines RPC_URL constant", () => {
    assertIncludes(js, "const RPC_URL");
  });

  it("has application state object with required fields", () => {
    assertIncludes(js, 'status: "INACTIVE"');
    assertIncludes(js, "timerDuration");
    assertIncludes(js, "receiverAddress");
    assertIncludes(js, "lastCheckIn");
  });

  it("has triggerInProgress lock flag", () => {
    assertIncludes(js, "let triggerInProgress = false");
  });

  it("has getReadableError() error mapping", () => {
    assertIncludes(js, "function getReadableError");
    assertIncludes(js, "AlreadyActive");
    assertIncludes(js, "TimeoutTooShort");
    assertIncludes(js, "NotInitialized");
    assertIncludes(js, "NotActive");
    assertIncludes(js, "WindowNotExceeded");
  });

  it("has parseSorobanError() for XDR decoding", () => {
    assertIncludes(js, "function parseSorobanError");
  });

  it("has withButtonSpinner() loading state helper", () => {
    assertIncludes(js, "async function withButtonSpinner");
    assertIncludes(js, "btn-loading");
  });

  it("has pollContractEvents() for event streaming", () => {
    assertIncludes(js, "async function pollContractEvents");
    assertIncludes(js, "getEvents");
  });

  it("has startEventPolling() and stopEventPolling()", () => {
    assertIncludes(js, "function startEventPolling");
    assertIncludes(js, "function stopEventPolling");
  });

  it("has connectWallet() function", () => {
    assertIncludes(js, "async function connectWallet");
  });

  it("has activateSwitch() function", () => {
    assertIncludes(js, "async function activateSwitch");
  });

  it("has checkIn() function", () => {
    assertIncludes(js, "async function checkIn");
  });

  it("has triggerEmergency() function with lock guard", () => {
    assertIncludes(js, "async function triggerEmergency");
    assertIncludes(js, "triggerInProgress = true");
  });

  it("has evaluateState() with status guards", () => {
    assertIncludes(js, "async function evaluateState");
    assertIncludes(js, 'state.status !== "ACTIVE"');
  });

  it("has saveState() using localStorage", () => {
    assertIncludes(js, "function saveState");
    assertIncludes(js, "localStorage.setItem");
  });

  it("has loadState() restoring from localStorage", () => {
    assertIncludes(js, "function loadState");
    assertIncludes(js, "localStorage.getItem");
  });

  it("uses EXTRA_TRIGGER_BUFFER_MS for ledger timing safety", () => {
    assertIncludes(js, "EXTRA_TRIGGER_BUFFER_MS");
  });
});

// ─── 5. Contract Source Tests ────────────────────────────────────────────────
describe("Smart Contract Source", () => {
  const contract = fs.readFileSync(path.join(projectRoot, "contract/src/lib.rs"), "utf8");

  it("uses #[contracttype] for structured types", () => {
    assertIncludes(contract, "#[contracttype]");
  });

  it("uses #[contracterror] for custom error types", () => {
    assertIncludes(contract, "#[contracterror]");
  });

  it("uses persistent storage", () => {
    assertIncludes(contract, "env.storage().persistent()");
  });

  it("uses require_auth() for owner verification", () => {
    assertIncludes(contract, "require_auth()");
  });

  it("uses token::Client for inter-contract communication", () => {
    assertIncludes(contract, "token::Client");
  });

  it("emits on-chain events via env.events().publish()", () => {
    assertIncludes(contract, "env.events().publish");
  });

  const events = ["init", "reset", "deposit", "chk_in", "trigger"];
  for (const event of events) {
    it(`emits "${event}" event`, () => {
      assertIncludes(contract, `symbol_short!("${event}")`);
    });
  }
});

// ─── 6. CI/CD Pipeline Tests ─────────────────────────────────────────────────
describe("CI/CD Pipeline", () => {
  const ci = fs.readFileSync(path.join(projectRoot, ".github/workflows/ci.yml"), "utf8");

  it("triggers on push to main", () => {
    assertIncludes(ci, "push:");
    assertIncludes(ci, "main");
  });

  it("triggers on pull_request to main", () => {
    assertIncludes(ci, "pull_request:");
  });

  it("builds WASM target", () => {
    assertIncludes(ci, "wasm32-unknown-unknown");
  });

  it("runs cargo test", () => {
    assertIncludes(ci, "cargo test");
  });

  it("uploads WASM artifact", () => {
    assertIncludes(ci, "upload-artifact");
  });
});

// ─── 7. Configuration Tests ─────────────────────────────────────────────────
describe("Package Configuration", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));

  it("has a dev script", () => {
    assert(pkg.scripts && pkg.scripts.dev, "Missing scripts.dev");
  });

  it("has a test script", () => {
    assert(pkg.scripts && pkg.scripts.test, "Missing scripts.test");
  });

  it("has @stellar/freighter-api dependency", () => {
    assert(
      (pkg.dependencies && pkg.dependencies["@stellar/freighter-api"]) ||
      (pkg.devDependencies && pkg.devDependencies["@stellar/freighter-api"]),
      "Missing @stellar/freighter-api"
    );
  });
});

// ─── Results ────────────────────────────────────────────────────────────────────
console.log("\n" + "─".repeat(50));
console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);

if (failures.length > 0) {
  console.log("❌ Failures:");
  for (const f of failures) {
    console.log(`   • ${f.name}: ${f.error}`);
  }
}

process.exit(failed > 0 ? 1 : 0);
