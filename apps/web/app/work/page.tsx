"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/StatusPill";
import { EmptyState } from "@/components/ui/EmptyState";

interface WorkTask {
  task_id: string;
  type: string;
  price_usdc: number;
  deadline_at: string;
  created_at: string;
}

function minutesUntil(iso: string): number {
  return Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
}

export default function WorkPage() {
  const [tasksList, setTasksList] = useState<WorkTask[] | null>(null);
  const [notSignedIn, setNotSignedIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/worker/tasks")
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401) {
          setNotSignedIn(true);
          return;
        }
        if (!res.ok) {
          setError("Could not load tasks. Try again.");
          return;
        }
        const body = await res.json();
        setTasksList(body.tasks);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load tasks. Try again.");
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

  if (!tasksList) {
    return <main className="mx-auto max-w-md px-4 py-8 text-center text-muted">Loading…</main>;
  }

  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <p className="font-mono text-[.75rem] font-bold uppercase tracking-[.22em] text-muted2">
        Find work
      </p>
      <h1 className="mt-1 font-display text-[1.75rem] font-extrabold tracking-[-0.01em] text-ink">
        Open <em className="font-serif italic font-semibold tracking-[-0.02em] text-forest">tasks.</em>
      </h1>

      {tasksList.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            heading={
              <>
                No tasks <em className="font-serif italic font-semibold text-forest">yet.</em>
              </>
            }
            body="Check back soon — new tasks appear here as they're posted in your city."
          />
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {tasksList.map((task) => {
            const minutesLeft = minutesUntil(task.deadline_at);
            return (
              <li key={task.task_id}>
                <Link
                  href={`/work/${task.task_id}`}
                  className="block rounded-lg border border-line bg-surface p-4 transition-all duration-150 hover:-translate-y-[3px] hover:shadow-[var(--sh-hover)]"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-ink">{task.type.replace("_", " ")}</p>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-ink">
                        {task.price_usdc.toFixed(2)}
                      </span>
                      <Badge>USDC</Badge>
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-muted2">
                    {minutesLeft > 0 ? `${minutesLeft} min left` : "Deadline passed"}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
