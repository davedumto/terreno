use soroban_sdk::{contracttype, Address, BytesN};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TaskStatus {
    Locked,
    Assigned,
    Released,
    Refunded,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Task {
    pub payer: Address,
    pub amount: i128,
    pub deadline: u64,
    pub worker: Option<Address>,
    pub status: TaskStatus,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Token,
    Treasury,
    FeeBps,
    Task(BytesN<32>),
}
