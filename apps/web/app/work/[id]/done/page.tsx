"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";

interface TaskDetail {
  task_id: string;
  status: string;
  price_usdc: number;
  release_tx: string | null;
}

type ViewState = "loading" | "ready" | "error";

export default function TaskDonePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [view, setView] = useState<ViewState>("loading");

  useEffect(() => {
    void Promise.resolve().then(async () => {
      const res = await fetch(`/api/worker/tasks/${id}`);
      if (!res.ok) {
        setView("error");
        return;
      }
      setTask(await res.json());
      setView("ready");
    });
  }, [id]);

  if (view === "loading") {
    return (
      <main className="mx-auto max-w-md px-4 py-8 text-center text-neutral-500">Loading…</main>
    );
  }

  if (view === "error" || !task) {
    return (
      <main className="mx-auto max-w-md px-4 py-8 text-center">
        <p className="text-neutral-700">Submitted. Could not load the latest status right now.</p>
        <Link href="/work" className="mt-4 inline-block text-blue-600 underline">
          Back to open tasks
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md px-4 py-8 text-center">
      <h1 className="text-xl font-semibold text-neutral-900">Submitted</h1>

      {task.status === "completed" ? (
        <>
          <p className="mt-2 text-neutral-700">
            You were paid {task.price_usdc.toFixed(2)} USDC.
          </p>
          {task.release_tx && (
            <a
              href={task.release_tx}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block text-sm text-blue-600 underline"
            >
              View transaction
            </a>
          )}
        </>
      ) : (
        <p className="mt-2 text-neutral-700">Payment is processing. It may take a little longer.</p>
      )}

      <div className="mt-8 flex flex-col gap-2">
        <Link href="/work" className="text-blue-600 underline">
          Find another task
        </Link>
        <Link href="/me" className="text-blue-600 underline">
          View your earnings
        </Link>
      </div>
    </main>
  );
}
