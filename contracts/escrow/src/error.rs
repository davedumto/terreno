use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// A task with this id already exists.
    AlreadyExists = 1,
    /// No task exists with this id.
    NotFound = 2,
    /// Amount must be greater than zero.
    InvalidAmount = 3,
    /// Deadline must be in the future.
    InvalidDeadline = 4,
    /// This action is not allowed from the task's current status.
    WrongStatus = 5,
    /// The task has no assigned worker.
    NotAssigned = 6,
    /// Fee exceeds the maximum allowed.
    FeeTooHigh = 7,
}
