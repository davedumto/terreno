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

// SPEC.md section 10: "an approximate local value" for /me's payout display,
// explicitly not a live rate. As-of ~2026-09, 1 USD in local currency.
// Revisit if this drifts noticeably before the demo.
export const APPROX_USD_TO_LOCAL: Record<"NG" | "CL" | "CR", { currency: string; rate: number }> = {
  NG: { currency: "NGN", rate: 1326 },
  CL: { currency: "CLP", rate: 909 },
  CR: { currency: "CRC", rate: 454 },
};
