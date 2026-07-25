#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token, Address, Env,
};

#[test]
fn test_switch_lifecycle() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, DeadmanSwitchContract);
    let client = DeadmanSwitchContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    let timeout = 10u64;

    // 1. Initial state — no switch yet
    assert!(client.get_switch(&owner).is_none());

    // 2. Initialize switch at ledger time 0
    client.init_switch(&owner, &beneficiary, &timeout);
    let state = client.get_switch(&owner).unwrap();
    assert_eq!(state.beneficiary, beneficiary);
    assert_eq!(state.timeout, timeout);
    assert_eq!(state.active, true);
    assert_eq!(state.balance, 0);

    // 3. Double initialization should fail (window is active: now=0 <= 0+10=10)
    let err = client.try_init_switch(&owner, &beneficiary, &timeout).unwrap_err();
    assert_eq!(err, Ok(Error::AlreadyActive.into()));

    // 4. Heartbeat Check-In (advance ledger time to 50)
    env.ledger().set_timestamp(50);
    client.check_in(&owner);
    let state = client.get_switch(&owner).unwrap();
    assert_eq!(state.last_check_in, 50);

    // 5. Reset switch
    client.reset_switch(&owner);
    let state = client.get_switch(&owner).unwrap();
    assert_eq!(state.active, false);

    // 6. Check-in after reset should fail
    let err = client.try_check_in(&owner).unwrap_err();
    assert_eq!(err, Ok(Error::NotActive.into()));
}

#[test]
fn test_trigger_timing() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, DeadmanSwitchContract);
    let client = DeadmanSwitchContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    let timeout = 50u64;

    // Start at ledger time 100
    env.ledger().set_timestamp(100);
    client.init_switch(&owner, &beneficiary, &timeout);

    // Ledger time 120 -> not expired (120 <= 100+50=150)
    env.ledger().set_timestamp(120);
    assert_eq!(client.is_expired(&owner), false);

    // Trigger should fail — window not exceeded
    let dummy_token = Address::generate(&env);
    let err = client.try_trigger(&owner, &dummy_token).unwrap_err();
    assert_eq!(err, Ok(Error::WindowNotExceeded.into()));

    // Ledger time 150 -> exactly at boundary (150 <= 150) → not expired
    env.ledger().set_timestamp(150);
    assert_eq!(client.is_expired(&owner), false);

    // Ledger time 151 -> expired (151 > 150)
    env.ledger().set_timestamp(151);
    assert_eq!(client.is_expired(&owner), true);
}

#[test]
fn test_deposit_and_trigger() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, DeadmanSwitchContract);
    let client = DeadmanSwitchContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    let timeout = 30u64;

    // Initialize switch at ledger time 100
    env.ledger().set_timestamp(100);
    client.init_switch(&owner, &beneficiary, &timeout);

    // Setup mock Stellar Asset Contract
    let token_admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_id = sac.address();
    let sac_admin = token::StellarAssetClient::new(&env, &token_id);
    let token_client = token::Client::new(&env, &token_id);

    // Mint 500 tokens to owner
    sac_admin.mint(&owner, &500);

    // Owner deposits 200 tokens into the deadman switch
    client.deposit(&owner, &token_id, &200);

    let state = client.get_switch(&owner).unwrap();
    assert_eq!(state.balance, 200);
    assert_eq!(token_client.balance(&contract_id), 200);
    assert_eq!(token_client.balance(&owner), 300);

    // Fast-forward ledger past expiry (100 + 30 = 130, so 131 > 130)
    env.ledger().set_timestamp(131);
    assert_eq!(client.is_expired(&owner), true);

    // Trigger the switch — anyone can call this
    client.trigger(&owner, &token_id);

    // Verify switch state updated
    let state = client.get_switch(&owner).unwrap();
    assert_eq!(state.active, false);
    assert_eq!(state.balance, 0);

    // Verify beneficiary received the funds
    assert_eq!(token_client.balance(&beneficiary), 200);
    assert_eq!(token_client.balance(&contract_id), 0);
}
