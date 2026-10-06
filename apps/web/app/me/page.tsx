"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { KpiCard } from "@/components/admin/KpiCard";

interface MeResponse {
  display_name: string;
  country: string;
  city: string;
  status: string;
  score: number;
  completed_tasks: number;
  balance: {
    usdc: number | null;
    error?: string;
    approx_local: { amount: number; currency: string } | null;
  };
  earnings: Array<{
    task_id: string;
    type: string;
    paid_usdc: number;
    release_tx: string;
    completed_at: string;
  }>;
  cash_out: { available: boolean; note: string };
}

export default function MePage() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [notSignedIn, setNotSignedIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/worker/me")
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401) {
          setNotSignedIn(true);
          return;
        }
        if (!res.ok) {
          setError("Could not load your profile. Try again.");
          return;
        }
        setMe(await res.json());
      })
      .catch(() => {
        if (!cancelled) setError("Could not load your profile. Try again.");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (notSignedIn) {
    return (
      <main className="mx-auto max-w-md px-4 py-8 text-center">
        <p className="text-muted">You need to sign in first.</p>
        <Link
          href="/join"
          className="mt-4 inline-block text-forest underline decoration-mint decoration-2 underline-offset-[3px] hover:text-ink"
        >
          Go to sign in
        </Link>
      </main>
    );
  }

  if (error) {
    return <main className="mx-auto max-w-md px-4 py-8 text-center text-coral">{error}</main>;
  }

  if (!me) {
    return <main className="mx-auto max-w-md px-4 py-8 text-center text-muted">Loading…</main>;
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <p className="font-mono text-[.75rem] font-bold uppercase tracking-[.22em] text-muted2">
        {me.city}, {me.country}
      </p>
      <h1 className="mt-1 font-display text-[1.75rem] font-extrabold tracking-[-0.01em] text-ink">
        {me.display_name}
      </h1>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard
          label="Balance"
          value={me.balance.usdc === null ? "—" : `${me.balance.usdc.toFixed(2)} USDC`}
          tint="forest"
        />
        <KpiCard label="Completed" value={String(me.completed_tasks)} tint="mint" />
        <KpiCard label="Score" value={me.score.toFixed(2)} tint="sun" />
      </div>

      {me.balance.usdc !== null && me.balance.approx_local && (
        <p className="mt-2 text-right text-sm text-muted">
          ≈ {Math.round(me.balance.approx_local.amount).toLocaleString()}{" "}
          {me.balance.approx_local.currency}
        </p>
      )}

      <section className="mt-8">
        <h2 className="font-mono text-[.75rem] font-bold uppercase tracking-[.22em] text-muted2">
          Earnings history
        </h2>
        {me.earnings.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              heading={
                <>
                  No completed tasks{" "}
                  <em className="font-serif italic font-semibold text-forest">yet.</em>
                </>
              }
              body="Completed tasks and their payouts show up here."
            />
          </div>
        ) : (
          <div className="mt-3 overflow-hidden rounded-lg border border-line bg-surface">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="border-b border-line px-4 py-3 text-left font-mono text-[11px] font-bold uppercase tracking-[.14em] text-muted2">
                    Task
                  </th>
                  <th className="border-b border-line px-4 py-3 text-left font-mono text-[11px] font-bold uppercase tracking-[.14em] text-muted2">
                    Date
                  </th>
                  <th className="border-b border-line px-4 py-3 text-right font-mono text-[11px] font-bold uppercase tracking-[.14em] text-muted2">
                    Paid
                  </th>
                </tr>
              </thead>
              <tbody>
                {me.earnings.map((entry) => (
                  <tr key={entry.task_id} className="transition-colors duration-150 hover:bg-chip">
                    <td className="border-b border-line px-4 py-3.5 text-sm text-ink">
                      {entry.type.replace(/_/g, " ")}
                    </td>
                    <td className="border-b border-line px-4 py-3.5 font-mono text-xs text-muted2">
                      {new Date(entry.completed_at).toLocaleDateString()}
                    </td>
                    <td className="border-b border-line px-4 py-3.5 text-right">
                      <div className="font-display text-sm font-bold tabular-nums text-ink">
                        {entry.paid_usdc.toFixed(2)}{" "}
                        <span className="font-mono text-xs font-normal text-muted2">USDC</span>
                      </div>
                      <a
                        href={entry.release_tx}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-xs text-forest underline decoration-mint decoration-2 underline-offset-[3px] hover:text-ink"
                      >
                        view tx
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="mt-6 text-center text-xs text-muted2">{me.cash_out.note}</p>
    </main>
  );
}
