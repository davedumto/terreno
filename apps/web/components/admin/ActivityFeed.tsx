import { EmptyState } from "@/components/ui/EmptyState";

export interface ActivityEvent {
  id: string;
  task_id: string;
  kind: string;
  created_at: string;
  summary: string;
}

const DOT_KIND: Record<string, "mint" | "sun" | "coral"> = {
  released: "mint",
  completed: "mint",
  paid: "sun",
  escrowed: "sun",
  claimed: "sun",
  submitted: "sun",
  notified: "sun",
  refunded: "coral",
  claim_expired: "coral",
  failed: "coral",
  policy_rejected: "coral",
};

const DOT_CLASSES: Record<"mint" | "sun" | "coral", string> = {
  mint: "bg-mint",
  sun: "bg-sun",
  coral: "bg-coral",
};

export function ActivityFeed({ events }: { events: ActivityEvent[] }) {
  if (events.length === 0) {
    return (
      <EmptyState
        heading={
          <>
            Nothing <em className="font-serif italic font-semibold text-forest">yet.</em>
          </>
        }
        body="Task activity appears here as it happens."
      />
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {events.map((event) => {
        const dot = DOT_KIND[event.kind] ?? "sun";
        return (
          <li key={event.id} className="flex items-center gap-3 text-sm">
            <span className={`size-[10px] shrink-0 rounded-full ${DOT_CLASSES[dot]}`} aria-hidden="true" />
            <span className="flex-1 font-semibold text-ink">{event.summary}</span>
            <span className="shrink-0 font-mono text-xs text-muted2">
              {new Date(event.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
