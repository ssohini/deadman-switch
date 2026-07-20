#![no_std]
use soroban_sdk::{contract, contracterror, contractimpl, contracttype, token, Address, Env};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SwitchState {
    pub beneficiary: Address,
    pub timeout: u64,
    pub last_check_in: u64,
    pub active: bool,
    pub balance: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Switch(Address),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyActive = 1,
    TimeoutTooShort = 2,
    NotInitialized = 3,
    NotActive = 4,
    WindowNotExceeded = 5,
    InvalidAmount = 6,
    InsufficientContractBalance = 7,
}

#[contract]
pub struct DeadmanSwitchContract;

#[contractimpl]
impl DeadmanSwitchContract {
    /// Initialize (or re-initialize after expiry) a deadman switch for an owner.
    /// Blocks re-init ONLY if there is already an active, non-expired switch.
    pub fn init_switch(
        env: Env,
        owner: Address,
        beneficiary: Address,
        timeout: u64,
    ) -> Result<(), Error> {
        owner.require_auth();

        if timeout < 2 {
            return Err(Error::TimeoutTooShort);
        }

        let key = DataKey::Switch(owner.clone());
        if let Some(existing) = env.storage().persistent().get::<DataKey, SwitchState>(&key) {
            if existing.active {
                // Only block if the existing switch is still within its timeout window
                let now = env.ledger().timestamp();
                if now <= existing.last_check_in + existing.timeout {
                    return Err(Error::AlreadyActive);
                }
                // Existing switch is active-flagged but ledger-expired → allow fresh init
            }
        }

        let state = SwitchState {
            beneficiary,
            timeout,
            last_check_in: env.ledger().timestamp(),
            active: true,
            balance: 0,
        };

        env.storage().persistent().set(&key, &state);
        Ok(())
    }

    /// Owner explicitly deactivates their switch (cancel/reset).
    pub fn reset_switch(env: Env, owner: Address) -> Result<(), Error> {
        owner.require_auth();

        let key = DataKey::Switch(owner.clone());
        let mut state = env
            .storage()
            .persistent()
            .get::<DataKey, SwitchState>(&key)
            .ok_or(Error::NotInitialized)?;

        state.active = false;
        env.storage().persistent().set(&key, &state);
        Ok(())
    }

    /// Owner deposits funds into their switch.
    pub fn deposit(env: Env, owner: Address, token: Address, amount: i128) -> Result<(), Error> {
        owner.require_auth();

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let key = DataKey::Switch(owner.clone());
        let mut state = env
            .storage()
            .persistent()
            .get::<DataKey, SwitchState>(&key)
            .ok_or(Error::NotInitialized)?;

        if !state.active {
            return Err(Error::NotActive);
        }

        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&owner, &env.current_contract_address(), &amount);

        state.balance += amount;
        env.storage().persistent().set(&key, &state);
        Ok(())
    }

    /// Owner checks in — resets the expiry clock to current ledger time.
    pub fn check_in(env: Env, owner: Address) -> Result<(), Error> {
        owner.require_auth();

        let key = DataKey::Switch(owner.clone());
        let mut state = env
            .storage()
            .persistent()
            .get::<DataKey, SwitchState>(&key)
            .ok_or(Error::NotInitialized)?;

        if !state.active {
            return Err(Error::NotActive);
        }

        state.last_check_in = env.ledger().timestamp();
        env.storage().persistent().set(&key, &state);
        Ok(())
    }

    /// Returns true if the switch is active and the timeout window has been exceeded on-chain.
    pub fn is_expired(env: Env, owner: Address) -> bool {
        let key = DataKey::Switch(owner);
        let state = match env.storage().persistent().get::<DataKey, SwitchState>(&key) {
            Some(s) => s,
            None => return false,
        };

        if !state.active {
            return false;
        }

        let now = env.ledger().timestamp();
        now > state.last_check_in + state.timeout
    }

    /// Trigger emergency protocol — transfers balance to beneficiary if expired.
    /// Can be called by anyone once the timeout window has been exceeded.
    pub fn trigger(env: Env, owner: Address, token: Address) -> Result<(), Error> {
        let key = DataKey::Switch(owner.clone());
        let mut state = env
            .storage()
            .persistent()
            .get::<DataKey, SwitchState>(&key)
            .ok_or(Error::NotInitialized)?;

        if !state.active {
            return Err(Error::NotActive);
        }

        let now = env.ledger().timestamp();
        if now <= state.last_check_in + state.timeout {
            return Err(Error::WindowNotExceeded);
        }

        // Mark as triggered
        state.active = false;

        // Release funds to beneficiary if balance > 0
        if state.balance > 0 {
            let token_client = token::Client::new(&env, &token);
            let contract_balance = token_client.balance(&env.current_contract_address());
            if contract_balance < state.balance {
                return Err(Error::InsufficientContractBalance);
            }
            token_client.transfer(&env.current_contract_address(), &state.beneficiary, &state.balance);
            state.balance = 0;
        }

        env.storage().persistent().set(&key, &state);
        Ok(())
    }

    /// Retrieve full status of a switch.
    pub fn get_switch(env: Env, owner: Address) -> Option<SwitchState> {
        let key = DataKey::Switch(owner);
        env.storage().persistent().get(&key)
    }
}
