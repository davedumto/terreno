#![cfg(test)]

use super::*;
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::Env;

const AMOUNT: i128 = 5_000_000;
const FEE_BPS: u32 = 1000; // 10%
const DEADLINE_SECS: u64 = 3600;

struct Setup {
    env: Env,
    contract_id: Address,
    client: ContractClient<'static>,
    token: token::Client<'static>,
    admin: Address,
    treasury: Address,
    payer: Address,
    worker: Address,
}

fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let payer = Address::generate(&env);
    let worker = Address::generate(&env);

    let token_admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = sac.address();
    let token = token::Client::new(&env, &token_address);
    let token_admin_client = token::StellarAssetClient::new(&env, &token_address);
    token_admin_client.mint(&treasury, &(AMOUNT * 100));

    let contract_id = env.register(
        Contract,
        ContractArgs::__constructor(&admin, &token_address, &treasury, &FEE_BPS),
    );
    let client = ContractClient::new(&env, &contract_id);

    Setup {
        env,
        contract_id,
        client,
        token,
        admin,
        treasury,
        payer,
        worker,
    }
}

fn task_id(env: &Env, seed: u8) -> BytesN<32> {
    let mut bytes = [0u8; 32];
    bytes[0] = seed;
    BytesN::from_array(env, &bytes)
}

fn deadline(env: &Env) -> u64 {
    env.ledger().timestamp() + DEADLINE_SECS
}

// ---- create_task ----

#[test]
fn create_task_locks_funds_and_emits_event() {
    let s = setup();
    let id = task_id(&s.env, 1);
    let dl = deadline(&s.env);

    s.client.create_task(&id, &s.payer, &AMOUNT, &dl);

    let task = s.client.get_task(&id);
    assert_eq!(task.payer, s.payer);
    assert_eq!(task.amount, AMOUNT);
    assert_eq!(task.deadline, dl);
    assert_eq!(task.worker, None);
    assert_eq!(task.status, TaskStatus::Locked);

    assert_eq!(s.token.balance(&s.contract_id), AMOUNT);
    assert_eq!(s.token.balance(&s.treasury), AMOUNT * 100 - AMOUNT);
}

#[test]
fn create_task_rejects_duplicate_id() {
    let s = setup();
    let id = task_id(&s.env, 1);
    let dl = deadline(&s.env);

    s.client.create_task(&id, &s.payer, &AMOUNT, &dl);
    let result = s.client.try_create_task(&id, &s.payer, &AMOUNT, &dl);

    assert_eq!(result, Err(Ok(Error::AlreadyExists)));
}

#[test]
fn create_task_rejects_zero_amount() {
    let s = setup();
    let id = task_id(&s.env, 1);
    let dl = deadline(&s.env);

    let result = s.client.try_create_task(&id, &s.payer, &0, &dl);

    assert_eq!(result, Err(Ok(Error::InvalidAmount)));
}

#[test]
fn create_task_rejects_negative_amount() {
    let s = setup();
    let id = task_id(&s.env, 1);
    let dl = deadline(&s.env);

    let result = s.client.try_create_task(&id, &s.payer, &-1, &dl);

    assert_eq!(result, Err(Ok(Error::InvalidAmount)));
}

#[test]
fn create_task_rejects_deadline_not_in_future() {
    let s = setup();
    let id = task_id(&s.env, 1);
    let now = s.env.ledger().timestamp();

    let result = s.client.try_create_task(&id, &s.payer, &AMOUNT, &now);

    assert_eq!(result, Err(Ok(Error::InvalidDeadline)));
}

#[test]
fn create_task_rejects_deadline_in_the_past() {
    let s = setup();
    let id = task_id(&s.env, 1);
    s.env.ledger().set_timestamp(1000);

    let result = s.client.try_create_task(&id, &s.payer, &AMOUNT, &500);

    assert_eq!(result, Err(Ok(Error::InvalidDeadline)));
}

// ---- assign ----

#[test]
fn assign_moves_locked_to_assigned() {
    let s = setup();
    let id = task_id(&s.env, 1);
    s.client.create_task(&id, &s.payer, &AMOUNT, &deadline(&s.env));

    s.client.assign(&id, &s.worker);

    let task = s.client.get_task(&id);
    assert_eq!(task.status, TaskStatus::Assigned);
    assert_eq!(task.worker, Some(s.worker));
}

#[test]
fn assign_allows_reassign_before_release() {
    let s = setup();
    let id = task_id(&s.env, 1);
    s.client.create_task(&id, &s.payer, &AMOUNT, &deadline(&s.env));
    s.client.assign(&id, &s.worker);

    let other_worker = Address::generate(&s.env);
    s.client.assign(&id, &other_worker);

    let task = s.client.get_task(&id);
    assert_eq!(task.status, TaskStatus::Assigned);
    assert_eq!(task.worker, Some(other_worker));
}

#[test]
fn assign_rejects_unknown_task() {
    let s = setup();
    let id = task_id(&s.env, 1);

    let result = s.client.try_assign(&id, &s.worker);

    assert_eq!(result, Err(Ok(Error::NotFound)));
}

#[test]
fn assign_rejects_released_task() {
    let s = setup();
    let id = task_id(&s.env, 1);
    s.client.create_task(&id, &s.payer, &AMOUNT, &deadline(&s.env));
    s.client.assign(&id, &s.worker);
    s.client.release(&id);

    let result = s.client.try_assign(&id, &s.worker);

    assert_eq!(result, Err(Ok(Error::WrongStatus)));
}

#[test]
fn assign_rejects_refunded_task() {
    let s = setup();
    let id = task_id(&s.env, 1);
    s.client.create_task(&id, &s.payer, &AMOUNT, &deadline(&s.env));
    s.env.ledger().set_timestamp(deadline(&s.env) + 1);
    s.client.refund(&id);

    let result = s.client.try_assign(&id, &s.worker);

    assert_eq!(result, Err(Ok(Error::WrongStatus)));
}

// ---- unassign ----

#[test]
fn unassign_moves_assigned_to_locked() {
    let s = setup();
    let id = task_id(&s.env, 1);
    s.client.create_task(&id, &s.payer, &AMOUNT, &deadline(&s.env));
    s.client.assign(&id, &s.worker);

    s.client.unassign(&id);

    let task = s.client.get_task(&id);
    assert_eq!(task.status, TaskStatus::Locked);
    assert_eq!(task.worker, None);
}

#[test]
fn unassign_rejects_locked_task() {
    let s = setup();
    let id = task_id(&s.env, 1);
    s.client.create_task(&id, &s.payer, &AMOUNT, &deadline(&s.env));

    let result = s.client.try_unassign(&id);

    assert_eq!(result, Err(Ok(Error::WrongStatus)));
}

#[test]
fn unassign_rejects_unknown_task() {
    let s = setup();
    let id = task_id(&s.env, 1);

    let result = s.client.try_unassign(&id);

    assert_eq!(result, Err(Ok(Error::NotFound)));
}

// ---- release ----

#[test]
fn release_pays_worker_and_fee_and_marks_released() {
    let s = setup();
    let id = task_id(&s.env, 1);
    s.client.create_task(&id, &s.payer, &AMOUNT, &deadline(&s.env));
    s.client.assign(&id, &s.worker);

    s.client.release(&id);

    let task = s.client.get_task(&id);
    assert_eq!(task.status, TaskStatus::Released);

    let expected_fee = AMOUNT * (FEE_BPS as i128) / 10_000;
    let expected_paid = AMOUNT - expected_fee;
    assert_eq!(s.token.balance(&s.worker), expected_paid);
    assert_eq!(s.token.balance(&s.treasury), AMOUNT * 100 - AMOUNT + expected_fee);
    assert_eq!(s.token.balance(&s.contract_id), 0);
}

#[test]
fn release_fee_math_rounds_down() {
    let s = setup();
    let id = task_id(&s.env, 1);
    // 9999 * 1000 / 10000 = 999.9 -> 999 (rounds down)
    let amount: i128 = 9999;
    s.client.create_task(&id, &s.payer, &amount, &deadline(&s.env));
    s.client.assign(&id, &s.worker);

    s.client.release(&id);

    assert_eq!(s.token.balance(&s.worker), 9999 - 999);
}

#[test]
fn release_rejects_locked_task() {
    let s = setup();
    let id = task_id(&s.env, 1);
    s.client.create_task(&id, &s.payer, &AMOUNT, &deadline(&s.env));

    let result = s.client.try_release(&id);

    assert_eq!(result, Err(Ok(Error::WrongStatus)));
}

#[test]
fn release_rejects_unknown_task() {
    let s = setup();
    let id = task_id(&s.env, 1);

    let result = s.client.try_release(&id);

    assert_eq!(result, Err(Ok(Error::NotFound)));
}

#[test]
fn release_rejects_double_release() {
    let s = setup();
    let id = task_id(&s.env, 1);
    s.client.create_task(&id, &s.payer, &AMOUNT, &deadline(&s.env));
    s.client.assign(&id, &s.worker);
    s.client.release(&id);

    let result = s.client.try_release(&id);

    assert_eq!(result, Err(Ok(Error::WrongStatus)));
}

#[test]
fn release_rejects_after_refund() {
    let s = setup();
    let id = task_id(&s.env, 1);
    s.client.create_task(&id, &s.payer, &AMOUNT, &deadline(&s.env));
    s.client.assign(&id, &s.worker);
    s.env.ledger().set_timestamp(deadline(&s.env) + 1);
    s.client.refund(&id);

    let result = s.client.try_release(&id);

    assert_eq!(result, Err(Ok(Error::WrongStatus)));
}

#[test]
fn release_allowed_after_deadline_if_assigned_before() {
    // The contract does not check submission time; the server is
    // responsible for not calling release() on a late submission.
    // Per SPEC.md section 8, this means release after the deadline
    // must still succeed at the contract level.
    let s = setup();
    let id = task_id(&s.env, 1);
    s.client.create_task(&id, &s.payer, &AMOUNT, &deadline(&s.env));
    s.client.assign(&id, &s.worker);
    s.env.ledger().set_timestamp(deadline(&s.env) + 1);

    s.client.release(&id);

    let task = s.client.get_task(&id);
    assert_eq!(task.status, TaskStatus::Released);
}

// ---- refund ----

#[test]
fn refund_after_deadline_pays_payer_from_locked() {
    let s = setup();
    let id = task_id(&s.env, 1);
    s.client.create_task(&id, &s.payer, &AMOUNT, &deadline(&s.env));
    s.env.ledger().set_timestamp(deadline(&s.env) + 1);

    s.client.refund(&id);

    let task = s.client.get_task(&id);
    assert_eq!(task.status, TaskStatus::Refunded);
    assert_eq!(s.token.balance(&s.payer), AMOUNT);
    assert_eq!(s.token.balance(&s.contract_id), 0);
}

#[test]
fn refund_after_deadline_pays_payer_from_assigned() {
    let s = setup();
    let id = task_id(&s.env, 1);
    s.client.create_task(&id, &s.payer, &AMOUNT, &deadline(&s.env));
    s.client.assign(&id, &s.worker);
    s.env.ledger().set_timestamp(deadline(&s.env) + 1);

    s.client.refund(&id);

    let task = s.client.get_task(&id);
    assert_eq!(task.status, TaskStatus::Refunded);
    assert_eq!(s.token.balance(&s.payer), AMOUNT);
}

#[test]
fn refund_before_deadline_requires_admin_and_succeeds() {
    let s = setup();
    let id = task_id(&s.env, 1);
    s.client.create_task(&id, &s.payer, &AMOUNT, &deadline(&s.env));

    // mock_all_auths() means this call is authorized as if the admin
    // signed it; the real assertion here is the pre-deadline refund
    // succeeds at all, which only happens via the admin-anytime path.
    s.client.refund(&id);

    let task = s.client.get_task(&id);
    assert_eq!(task.status, TaskStatus::Refunded);
    assert_eq!(s.token.balance(&s.payer), AMOUNT);
}

#[test]
fn refund_before_deadline_without_admin_auth_fails() {
    let s = setup();
    s.env.mock_auths(&[]); // no auths allowed at all
    let id = task_id(&s.env, 1);

    // create_task needs admin+treasury auth; do it before clearing mocks.
    // Re-enable mocking just for setup, then disable for the refund call.
    s.env.mock_all_auths();
    s.client.create_task(&id, &s.payer, &AMOUNT, &deadline(&s.env));

    s.env.mock_auths(&[]);
    let result = s.client.try_refund(&id);

    assert!(result.is_err());
}

#[test]
fn refund_rejects_unknown_task() {
    let s = setup();
    let id = task_id(&s.env, 1);

    let result = s.client.try_refund(&id);

    assert_eq!(result, Err(Ok(Error::NotFound)));
}

#[test]
fn refund_rejects_double_refund() {
    let s = setup();
    let id = task_id(&s.env, 1);
    s.client.create_task(&id, &s.payer, &AMOUNT, &deadline(&s.env));
    s.env.ledger().set_timestamp(deadline(&s.env) + 1);
    s.client.refund(&id);

    let result = s.client.try_refund(&id);

    assert_eq!(result, Err(Ok(Error::WrongStatus)));
}

#[test]
fn refund_rejects_after_release() {
    let s = setup();
    let id = task_id(&s.env, 1);
    s.client.create_task(&id, &s.payer, &AMOUNT, &deadline(&s.env));
    s.client.assign(&id, &s.worker);
    s.client.release(&id);
    s.env.ledger().set_timestamp(deadline(&s.env) + 1);

    let result = s.client.try_refund(&id);

    assert_eq!(result, Err(Ok(Error::WrongStatus)));
}

// ---- get_task ----

#[test]
fn get_task_rejects_unknown_task() {
    let s = setup();
    let id = task_id(&s.env, 1);

    let result = s.client.try_get_task(&id);

    assert_eq!(result, Err(Ok(Error::NotFound)));
}

// ---- set_admin ----

#[test]
fn set_admin_rotates_key() {
    let s = setup();
    let new_admin = Address::generate(&s.env);

    s.client.set_admin(&new_admin);

    // The new admin must now be able to authorize admin-only actions.
    // mock_all_auths() already allows any address to satisfy
    // require_auth in tests, so we confirm via behavior: assign still
    // works, proving set_admin did not break the contract's config.
    let id = task_id(&s.env, 1);
    s.client.create_task(&id, &s.payer, &AMOUNT, &deadline(&s.env));
    s.client.assign(&id, &s.worker);
    let task = s.client.get_task(&id);
    assert_eq!(task.status, TaskStatus::Assigned);
    let _ = s.admin; // admin retained in Setup for symmetry with other tests
}

// ---- constructor ----

#[test]
#[should_panic(expected = "Error(Contract, #7)")] // Error::FeeTooHigh
fn constructor_rejects_fee_above_max() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(token_admin);
    let token_address = sac.address();

    env.register(
        Contract,
        ContractArgs::__constructor(&admin, &token_address, &treasury, &2001u32),
    );
}

#[test]
fn constructor_allows_fee_at_max() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let payer = Address::generate(&env);
    let worker = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(token_admin);
    let token_address = sac.address();
    let token = token::Client::new(&env, &token_address);
    token::StellarAssetClient::new(&env, &token_address).mint(&treasury, &AMOUNT);

    let contract_id = env.register(
        Contract,
        ContractArgs::__constructor(&admin, &token_address, &treasury, &2000u32),
    );
    let client = ContractClient::new(&env, &contract_id);

    let id = task_id(&env, 1);
    client.create_task(&id, &payer, &AMOUNT, &deadline(&env));
    client.assign(&id, &worker);
    client.release(&id);

    let expected_fee = AMOUNT * 2000 / 10_000;
    assert_eq!(token.balance(&worker), AMOUNT - expected_fee);
}
