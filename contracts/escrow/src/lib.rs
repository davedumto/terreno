#![no_std]

mod error;
mod event;
mod storage;
mod test;

use error::Error;
use event::{Assigned, Created, Refunded, Released};
use soroban_sdk::{contract, contractimpl, token, Address, BytesN, Env};
use storage::{DataKey, Task, TaskStatus};

const MAX_FEE_BPS: u32 = 2000;
const FEE_DENOMINATOR: i128 = 10_000;

// TTL extension for the persistent Task entry, in ledgers. Soroban ledgers
// close roughly every 5s, so ~30 days of headroom comfortably outlives any
// task's deadline (max 180 minutes per SPEC.md section 6).
const TASK_TTL_THRESHOLD: u32 = 100_000;
const TASK_TTL_EXTEND_TO: u32 = 518_400;

#[contract]
pub struct Contract;

#[contractimpl]
impl Contract {
    pub fn __constructor(env: Env, admin: Address, token: Address, treasury: Address, fee_bps: u32) {
        if fee_bps > MAX_FEE_BPS {
            env.panic_with_error(Error::FeeTooHigh);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::Treasury, &treasury);
        env.storage().instance().set(&DataKey::FeeBps, &fee_bps);
    }

    pub fn create_task(
        env: Env,
        id: BytesN<32>,
        payer: Address,
        amount: i128,
        deadline: u64,
    ) -> Result<(), Error> {
        let treasury = Self::treasury(&env);
        Self::admin(&env).require_auth();
        treasury.require_auth();

        if env.storage().persistent().has(&DataKey::Task(id.clone())) {
            return Err(Error::AlreadyExists);
        }
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if deadline <= env.ledger().timestamp() {
            return Err(Error::InvalidDeadline);
        }

        let token_client = token::Client::new(&env, &Self::token(&env));
        token_client.transfer(&treasury, env.current_contract_address(), &amount);

        let task = Task {
            payer: payer.clone(),
            amount,
            deadline,
            worker: None,
            status: TaskStatus::Locked,
        };
        Self::write_task(&env, &id, &task);

        Created {
            id,
            payer,
            amount,
            deadline,
        }
        .publish(&env);

        Ok(())
    }

    pub fn assign(env: Env, id: BytesN<32>, worker: Address) -> Result<(), Error> {
        Self::admin(&env).require_auth();

        let mut task = Self::read_task(&env, &id)?;
        match task.status {
            TaskStatus::Locked | TaskStatus::Assigned => {}
            TaskStatus::Released | TaskStatus::Refunded => return Err(Error::WrongStatus),
        }

        task.worker = Some(worker.clone());
        task.status = TaskStatus::Assigned;
        Self::write_task(&env, &id, &task);

        Assigned { id, worker }.publish(&env);

        Ok(())
    }

    pub fn unassign(env: Env, id: BytesN<32>) -> Result<(), Error> {
        Self::admin(&env).require_auth();

        let mut task = Self::read_task(&env, &id)?;
        if task.status != TaskStatus::Assigned {
            return Err(Error::WrongStatus);
        }

        task.worker = None;
        task.status = TaskStatus::Locked;
        Self::write_task(&env, &id, &task);

        Ok(())
    }

    pub fn release(env: Env, id: BytesN<32>) -> Result<(), Error> {
        Self::admin(&env).require_auth();

        let task = Self::read_task(&env, &id)?;
        if task.status != TaskStatus::Assigned {
            return Err(Error::WrongStatus);
        }
        // Invariant: assign() always sets worker alongside status = Assigned,
        // and no other path produces this status, so worker is always Some here.
        let worker = task.worker.clone().unwrap();

        let fee_bps = Self::fee_bps(&env);
        let fee = task.amount * (fee_bps as i128) / FEE_DENOMINATOR;
        let paid = task.amount - fee;

        let mut updated = task.clone();
        updated.status = TaskStatus::Released;
        Self::write_task(&env, &id, &updated);

        let token_client = token::Client::new(&env, &Self::token(&env));
        let contract_address = env.current_contract_address();
        token_client.transfer(&contract_address, &worker, &paid);
        if fee > 0 {
            token_client.transfer(&contract_address, Self::treasury(&env), &fee);
        }

        Released {
            id,
            worker,
            paid,
            fee,
        }
        .publish(&env);

        Ok(())
    }

    pub fn refund(env: Env, id: BytesN<32>) -> Result<(), Error> {
        let task = Self::read_task(&env, &id)?;
        match task.status {
            TaskStatus::Locked | TaskStatus::Assigned => {}
            TaskStatus::Released | TaskStatus::Refunded => return Err(Error::WrongStatus),
        }

        let admin = Self::admin(&env);
        if env.ledger().timestamp() < task.deadline {
            admin.require_auth();
        }

        let mut updated = task.clone();
        updated.status = TaskStatus::Refunded;
        Self::write_task(&env, &id, &updated);

        let token_client = token::Client::new(&env, &Self::token(&env));
        token_client.transfer(&env.current_contract_address(), &task.payer, &task.amount);

        Refunded {
            id,
            payer: task.payer,
            amount: task.amount,
        }
        .publish(&env);

        Ok(())
    }

    pub fn get_task(env: Env, id: BytesN<32>) -> Result<Task, Error> {
        Self::read_task(&env, &id)
    }

    pub fn set_admin(env: Env, new: Address) {
        Self::admin(&env).require_auth();
        env.storage().instance().set(&DataKey::Admin, &new);
    }

    fn admin(env: &Env) -> Address {
        env.storage().instance().get(&DataKey::Admin).unwrap()
    }

    fn token(env: &Env) -> Address {
        env.storage().instance().get(&DataKey::Token).unwrap()
    }

    fn treasury(env: &Env) -> Address {
        env.storage().instance().get(&DataKey::Treasury).unwrap()
    }

    fn fee_bps(env: &Env) -> u32 {
        env.storage().instance().get(&DataKey::FeeBps).unwrap()
    }

    fn read_task(env: &Env, id: &BytesN<32>) -> Result<Task, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Task(id.clone()))
            .ok_or(Error::NotFound)
    }

    fn write_task(env: &Env, id: &BytesN<32>, task: &Task) {
        let key = DataKey::Task(id.clone());
        env.storage().persistent().set(&key, task);
        env.storage()
            .persistent()
            .extend_ttl(&key, TASK_TTL_THRESHOLD, TASK_TTL_EXTEND_TO);
    }
}
