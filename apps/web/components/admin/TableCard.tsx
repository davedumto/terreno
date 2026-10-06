import Link from "next/link";
import { StatusPill, type TaskStatus } from "@/components/ui/StatusPill";
import { EmptyState } from "@/components/ui/EmptyState";

export interface AdminTaskRow {
  task_id: string;
  type: string;
  status: TaskStatus;
  price_usdc: number;
  fee_usdc: number;
  net_usdc: number;
  country: string;
  city: string;
  worker_display_name: string | null;
  created_at: string;
  updated_at: string;
}

interface TableCardProps {
  tasks: AdminTaskRow[];
  footer?: React.ReactNode;
}

function truncateMiddle(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

export function TableCard({ tasks, footer }: TableCardProps) {
  if (tasks.length === 0) {
    return (
      <div className="rounded-lg border border-line bg-surface p-6">
        <EmptyState
          heading={
            <>
              No tasks <em className="font-serif italic font-semibold text-forest">yet.</em>
            </>
          }
          body="Real tasks will show up here as agents pay for them."
        />
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-line bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="border-b border-line px-4 py-3 text-left font-mono text-[11px] font-bold uppercase tracking-[.14em] text-muted2">
                Task
              </th>
              <th className="border-b border-line px-4 py-3 text-left font-mono text-[11px] font-bold uppercase tracking-[.14em] text-muted2">
                Worker
              </th>
              <th className="border-b border-line px-4 py-3 text-left font-mono text-[11px] font-bold uppercase tracking-[.14em] text-muted2">
                City
              </th>
              <th className="border-b border-line px-4 py-3 text-left font-mono text-[11px] font-bold uppercase tracking-[.14em] text-muted2">
                Status
              </th>
              <th className="border-b border-line px-4 py-3 text-right font-mono text-[11px] font-bold uppercase tracking-[.14em] text-muted2">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <tr key={task.task_id} className="transition-colors duration-150 hover:bg-chip">
                <td className="border-b border-line px-4 py-3.5 text-sm">
                  <div className="text-ink">{task.type.replace(/_/g, " ")}</div>
                  <div className="font-mono text-xs text-muted2">{truncateMiddle(task.task_id)}</div>
                </td>
                <td className="border-b border-line px-4 py-3.5 text-sm text-ink">
                  {task.worker_display_name ?? <span className="text-muted2">Unclaimed</span>}
                </td>
                <td className="border-b border-line px-4 py-3.5 text-sm text-muted">
                  {task.city}, {task.country}
                </td>
                <td className="border-b border-line px-4 py-3.5">
                  <StatusPill status={task.status} />
                </td>
                <td className="border-b border-line px-4 py-3.5 text-right font-display text-sm font-bold tabular-nums text-ink">
                  {task.net_usdc.toFixed(2)} <span className="font-mono text-xs font-normal text-muted2">USDC</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {footer && (
        <div className="flex items-center justify-between border-t border-line px-6 py-4">{footer}</div>
      )}
    </div>
  );
}

export function ViewAllLink({ href }: { href: string }) {
  return (
    <Link href={href} className="font-mono text-xs font-semibold text-forest hover:text-ink">
      View all →
    </Link>
  );
}
