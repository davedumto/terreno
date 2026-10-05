#![no_std]
use soroban_sdk::{contract, contractimpl, vec, Env, String, Vec};

// Placeholder contract for Phase 0 (repo scaffold + CI wiring only).
// The real escrow (storage, create_task/assign/unassign/release/refund,
// events, errors) is written in Phase 1 per SPEC.md section 8, with
// tests for every function and every error path before anything else
// depends on it.
#[contract]
pub struct Contract;

#[contractimpl]
impl Contract {
    pub fn hello(env: Env, to: String) -> Vec<String> {
        vec![&env, String::from_str(&env, "Hello"), to]
    }
}

mod test;
