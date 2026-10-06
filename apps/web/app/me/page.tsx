"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Field } from "@/components/ui/Field";
import { EmptyState } from "@/components/ui/EmptyState";

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
    <main className="mx-auto max-w-md px-4 py-8">
      <h1 className="font-display text-[1.75rem] font-extrabold tracking-[-0.01em] text-ink">
        {me.display_name}
      </h1>
      <p className="text-sm text-muted">
        {me.city}, {me.country}
      </p>

      <section className="mt-6 rounded-lg border border-line bg-surface p-4">
        <p className="text-[.6875rem] font-bold uppercase tracking-[.14em] text-muted2">Balance</p>
        {me.balance.usdc === null ? (
          <p className="mt-1 text-muted">Balance unavailable right now</p>
        ) : (
          <>
            <p className="mt-1 font-display text-[clamp(2rem,1.6rem+1.4vw,3rem)] font-extrabold leading-none text-ink">
              {me.balance.usdc.toFixed(2)} <span className="text-[1rem] font-bold text-muted2">USDC</span>
            </p>
            {me.balance.approx_local && (
              <p className="mt-1 text-sm text-muted">
                ≈ {Math.round(me.balance.approx_local.amount).toLocaleString()}{" "}
                {me.balance.approx_local.currency}
              </p>
            )}
          </>
        )}
      </section>

      <section className="mt-4 grid grid-cols-2 gap-3">
        <Field label="Completed" value={me.completed_tasks} />
        <Field label="Score" value={me.score.toFixed(2)} />
      </section>

      <section className="mt-6">
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
          <ul className="mt-2 space-y-2">
            {me.earnings.map((entry) => (
              <li
                key={entry.task_id}
                className="flex items-center justify-between rounded-lg border border-line bg-surface p-3"
              >
                <div>
                  <p className="text-sm text-ink">{entry.type.replace("_", " ")}</p>
                  <p className="font-mono text-xs text-muted2">
                    {new Date(entry.completed_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-ink">{entry.paid_usdc.toFixed(2)} USDC</p>
                  <a
                    href={entry.release_tx}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-xs text-forest underline decoration-mint decoration-2 underline-offset-[3px] hover:text-ink"
                  >
                    view tx
                  </a>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-6 text-center text-xs text-muted2">{me.cash_out.note}</p>
    </main>
  );
}
