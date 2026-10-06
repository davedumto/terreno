"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { KpiCard } from "@/components/admin/KpiCard";
import { ActivityFeed, type ActivityEvent } from "@/components/admin/ActivityFeed";
import { TableCard, ViewAllLink, type AdminTaskRow } from "@/components/admin/TableCard";
import { EmptyState } from "@/components/ui/EmptyState";

interface Metric {
  count: number;
  deltaPct: number | null;
}

interface KpiResponse {
  completed: Metric;
  pending: Metric;
  refunded: Metric;
  volumeUsdc: { amount: number; deltaPct: number | null };
}

interface VolumePoint {
  date: string;
  volumeUsdc: number;
}

export default function AdminOverviewPage() {
  const [kpis, setKpis] = useState<KpiResponse | null>(null);
  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
  const [tasks, setTasks] = useState<AdminTaskRow[] | null>(null);
  const [volumePoints, setVolumePoints] = useState<VolumePoint[] | null>(null);

  useEffect(() => {
    void Promise.all([
      fetch("/api/admin/kpis").then((res) => res.json()),
      fetch("/api/admin/events?limit=8").then((res) => res.json()),
      fetch("/api/admin/tasks?pageSize=8").then((res) => res.json()),
      fetch("/api/admin/volume?range=7d").then((res) => res.json()),
    ]).then(([kpisBody, eventsBody, tasksBody, volumeBody]) => {
      setKpis(kpisBody);
      setEvents(eventsBody.events);
      setTasks(tasksBody.tasks);
      setVolumePoints(volumeBody.points);
    });
  }, []);

  return (
    <>
      <PageHeader
        eyebrow="Terreno ops · Testnet"
        title={
          <>
            Your payment layer, <em className="font-serif italic font-semibold text-forest">live.</em>
          </>
        }
        lead="Real tasks, real escrow, real payouts to real workers."
      />

      {kpis && (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            label="Completed · 24h"
            value={kpis.completed.count.toLocaleString()}
            deltaPct={kpis.completed.deltaPct}
            href="/admin/tasks?status=completed"
            goLabel="View completed"
            tint="mint"
          />
          <KpiCard
            label="Pending · 24h"
            value={kpis.pending.count.toLocaleString()}
            deltaPct={kpis.pending.deltaPct}
            href="/admin/tasks?status=open&status=claimed"
            goLabel="View pending"
            tint="sun"
          />
          <KpiCard
            label="Refunded · 24h"
            value={kpis.refunded.count.toLocaleString()}
            deltaPct={kpis.refunded.deltaPct}
            href="/admin/tasks?status=refunded"
            goLabel="View refunded"
            tint="lime"
          />
          <KpiCard
            label="Volume · 24h"
            value={`${kpis.volumeUsdc.amount.toFixed(2)} USDC`}
            deltaPct={kpis.volumeUsdc.deltaPct}
            href="/admin/tasks?status=completed"
            goLabel="View payments"
            tint="forest"
          />
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <div className="rounded-lg border border-line bg-surface p-6">
            <p className="font-mono text-[.75rem] font-bold uppercase tracking-[.08em] text-muted2">
              Volume · 7D
            </p>
            <h2 className="mt-1 font-display text-[1.1875rem] font-bold text-ink">Settled volume</h2>
            <div className="mt-4">
              {volumePoints && volumePoints.length > 1 ? (
                <VolumeBars points={volumePoints} />
              ) : (
                <EmptyState
                  heading={
                    <>
                      Not enough data{" "}
                      <em className="font-serif italic font-semibold text-forest">yet.</em>
                    </>
                  }
                  body="A real volume chart needs more than one settled task to be meaningful."
                />
              )}
            </div>
          </div>
        </div>
        <div className="lg:col-span-4">
          <div className="rounded-lg border border-line bg-surface p-6">
            <p className="font-mono text-[.75rem] font-bold uppercase tracking-[.08em] text-muted2">
              Activity
            </p>
            <div className="mt-4">{events && <ActivityFeed events={events} />}</div>
          </div>
        </div>
      </div>

      <div className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-[1.1875rem] font-bold text-ink">Recent payments</h2>
          <ViewAllLink href="/admin/tasks" />
        </div>
        {tasks && <TableCard tasks={tasks} />}
      </div>
    </>
  );
}

function VolumeBars({ points }: { points: VolumePoint[] }) {
  const max = Math.max(...points.map((p) => p.volumeUsdc), 1);
  return (
    <div className="flex h-[220px] items-end gap-2">
      {points.map((point) => (
        <div key={point.date} className="flex flex-1 flex-col items-center gap-2">
          <div
            className="w-full rounded-t-sm bg-mint/60"
            style={{ height: `${Math.max((point.volumeUsdc / max) * 100, 2)}%` }}
          />
          <span className="font-mono text-[10px] text-muted2">
            {new Date(point.date).toLocaleDateString([], { month: "short", day: "numeric" })}
          </span>
        </div>
      ))}
    </div>
  );
}
