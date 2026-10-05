// Amounts are integers in stroops (7 decimals). 0.50 USDC = 5_000_000 stroops.

export const TASK_TYPES = ["verify_place", "check_price", "translate"] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const TASK_PRICES_STROOPS: Record<TaskType, number> = {
  verify_place: 5_000_000,
  check_price: 5_000_000,
  translate: 3_000_000,
};

export const FEE_BPS = 1000; // 10%, max 2000 per spec section 8
export const MAX_FEE_BPS = 2000;

export const DEADLINE_MINUTES_MIN = 15;
export const DEADLINE_MINUTES_MAX = 180;

export const CLAIM_WINDOW_MINUTES = 15;

export const MAX_QUESTION_LENGTH = 500;
export const MAX_SOURCE_TEXT_LENGTH = 500;

export const LIVE_CITY_MIN_ACTIVE_WORKERS = 2;

export const RATE_LIMIT_PAID_TASKS_PER_PAYER_PER_HOUR = 20;
export const RATE_LIMIT_REQUESTS_PER_IP_PER_MINUTE = 60;
