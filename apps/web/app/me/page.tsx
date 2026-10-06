"use client";

import { useEffect, useState } from "react";

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
        <p className="text-neutral-700">You need to sign in first.</p>
        <a href="/join" className="mt-4 inline-block text-blue-600 underline">
          Go to sign in
        </a>
      </main>
    );
  }

  if (error) {
    return (
      <main className="mx-auto max-w-md px-4 py-8 text-center text-red-600">
        {error}
      </main>
    );
  }

  if (!me) {
    return (
      <main className="mx-auto max-w-md px-4 py-8 text-center text-neutral-500">
        Loading…
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <h1 className="text-xl font-semibold text-neutral-900">{me.display_name}</h1>
      <p className="text-sm text-neutral-500">
        {me.city}, {me.country}
      </p>

      <section className="mt-6 rounded-lg border border-neutral-200 p-4">
        <p className="text-sm text-neutral-500">Balance</p>
        {me.balance.usdc === null ? (
          <p className="mt-1 text-neutral-400">Balance unavailable right now</p>
        ) : (
          <>
            <p className="mt-1 text-2xl font-semibold text-neutral-900">
              {me.balance.usdc.toFixed(2)} USDC
            </p>
            {me.balance.approx_local && (
              <p className="text-sm text-neutral-500">
                ≈ {Math.round(me.balance.approx_local.amount).toLocaleString()}{" "}
                {me.balance.approx_local.currency}
              </p>
            )}
          </>
        )}
      </section>

      <section className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-neutral-200 p-4">
          <p className="text-sm text-neutral-500">Completed</p>
          <p className="text-xl font-semibold text-neutral-900">{me.completed_tasks}</p>
        </div>
        <div className="rounded-lg border border-neutral-200 p-4">
          <p className="text-sm text-neutral-500">Score</p>
          <p className="text-xl font-semibold text-neutral-900">{me.score.toFixed(2)}</p>
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-medium text-neutral-700">Earnings history</h2>
        {me.earnings.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-400">No completed tasks yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {me.earnings.map((entry) => (
              <li
                key={entry.task_id}
                className="flex items-center justify-between rounded-lg border border-neutral-200 p-3"
              >
                <div>
                  <p className="text-sm text-neutral-900">{entry.type.replace("_", " ")}</p>
                  <p className="text-xs text-neutral-400">
                    {new Date(entry.completed_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-neutral-900">
                    {entry.paid_usdc.toFixed(2)} USDC
                  </p>
                  <a
                    href={entry.release_tx}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 underline"
                  >
                    view tx
                  </a>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-6 text-center text-xs text-neutral-400">{me.cash_out.note}</p>
    </main>
  );
}
