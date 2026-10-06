export type TaskStatus = "paid" | "open" | "claimed" | "submitted" | "completed" | "refunded";
export type WorkerStatus = "active" | "paused" | "banned";

interface StatusPillProps {
  status: TaskStatus | WorkerStatus;
  label?: string;
}

type PillVariant = "settled" | "pending" | "refused" | "inactive";

// The design spec defines exactly 4 pill variants against Terreno's 6 real
// task statuses + 3 worker statuses. `paid` and `submitted` are brief
// pre-escrow/pre-release moments, not a 5th visual category of their own, so
// they render as `pending` alongside `open`/`claimed`.
const TASK_STATUS_VARIANT: Record<TaskStatus, PillVariant> = {
  paid: "pending",
  open: "pending",
  claimed: "pending",
  submitted: "pending",
  completed: "settled",
  refunded: "refused",
};

const WORKER_STATUS_VARIANT: Record<WorkerStatus, PillVariant> = {
  active: "settled",
  paused: "refused",
  banned: "refused",
};

const DEFAULT_LABEL: Record<TaskStatus | WorkerStatus, string> = {
  paid: "Paid",
  open: "Open",
  claimed: "Claimed",
  submitted: "Submitted",
  completed: "Completed",
  refunded: "Refunded",
  active: "Active",
  paused: "Paused",
  banned: "Banned",
};

const VARIANT_CLASSES: Record<PillVariant, string> = {
  settled: "bg-mint-soft text-forest-ink",
  pending: "bg-sun-soft text-forest-ink",
  refused: "bg-coral-soft text-[#8a1f17]",
  inactive: "bg-chip text-muted",
};

const DOT_CLASSES: Record<PillVariant, string> = {
  settled: "bg-mint",
  pending: "bg-sun animate-pulse",
  refused: "bg-coral",
  inactive: "bg-muted2",
};

function isWorkerStatus(status: TaskStatus | WorkerStatus): status is WorkerStatus {
  return status === "active" || status === "paused" || status === "banned";
}

export function StatusPill({ status, label }: StatusPillProps) {
  const variant = isWorkerStatus(status) ? WORKER_STATUS_VARIANT[status] : TASK_STATUS_VARIANT[status];

  return (
    <span
      className={`inline-flex items-center gap-[6px] rounded-pill px-[10px] py-[4px] text-sm font-bold ${VARIANT_CLASSES[variant]}`}
    >
      <span className={`size-[6px] rounded-full ${DOT_CLASSES[variant]}`} aria-hidden="true" />
      {label ?? DEFAULT_LABEL[status]}
    </span>
  );
}

interface BadgeProps {
  children: React.ReactNode;
}

export function Badge({ children }: BadgeProps) {
  return (
    <span className="inline-flex items-center rounded-md border border-line bg-surface px-[12px] py-[6px] text-sm font-bold font-mono text-muted">
      {children}
    </span>
  );
}
