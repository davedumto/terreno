"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

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
        <p className="text-neutral-700">You need to sign in first.</p>
        <Link href="/join" className="mt-4 inline-block text-blue-600 underline">
          Go to sign in
        </Link>
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

  if (!tasksList) {
    return (
      <main className="mx-auto max-w-md px-4 py-8 text-center text-neutral-500">
        Loading…
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <h1 className="text-xl font-semibold text-neutral-900">Open tasks</h1>

      {tasksList.length === 0 ? (
        <p className="mt-6 text-sm text-neutral-400">No open tasks right now. Check back soon.</p>
      ) : (
        <ul className="mt-6 space-y-3">
          {tasksList.map((task) => {
            const minutesLeft = minutesUntil(task.deadline_at);
            return (
              <li key={task.task_id}>
                <Link
                  href={`/work/${task.task_id}`}
                  className="block rounded-lg border border-neutral-200 p-4 hover:border-neutral-300"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-neutral-900">
                      {task.type.replace("_", " ")}
                    </p>
                    <p className="text-sm font-semibold text-neutral-900">
                      {task.price_usdc.toFixed(2)} USDC
                    </p>
                  </div>
                  <p className="mt-1 text-xs text-neutral-500">
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
