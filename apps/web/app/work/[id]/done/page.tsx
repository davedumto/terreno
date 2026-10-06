"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { buttonClasses } from "@/components/ui/buttonStyles";

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
    return <main className="mx-auto max-w-md px-4 py-8 text-center text-muted">Loading…</main>;
  }

  if (view === "error" || !task) {
    return (
      <main className="mx-auto max-w-md px-4 py-8 text-center">
        <p className="text-muted">Submitted. Could not load the latest status right now.</p>
        <Link
          href="/work"
          className="mt-4 inline-block text-forest underline decoration-mint decoration-2 underline-offset-[3px] hover:text-ink"
        >
          Back to open tasks
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md px-4 py-8 text-center">
      <h1 className="font-display text-[1.75rem] font-extrabold tracking-[-0.01em] text-ink">
        Submitted<em className="font-serif italic font-semibold text-forest">.</em>
      </h1>

      {task.status === "completed" ? (
        <>
          <p className="mt-4 text-sm text-muted">You were paid</p>
          <p className="font-display text-[clamp(2rem,1.6rem+1.4vw,3rem)] font-extrabold leading-none text-ink">
            {task.price_usdc.toFixed(2)} <span className="text-[1rem] font-bold text-muted2">USDC</span>
          </p>
          {task.release_tx && (
            <a
              href={task.release_tx}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-block text-sm text-forest underline decoration-mint decoration-2 underline-offset-[3px] hover:text-ink"
            >
              View transaction
            </a>
          )}
        </>
      ) : (
        <p className="mt-2 text-muted">Payment is processing. It may take a little longer.</p>
      )}

      <div className="mt-8 flex flex-col gap-2">
        <Link href="/work" className={buttonClasses({ variant: "outline" })}>
          Find another task
        </Link>
        <Link href="/me" className={buttonClasses({ variant: "outline" })}>
          View your earnings
        </Link>
      </div>
    </main>
  );
}
