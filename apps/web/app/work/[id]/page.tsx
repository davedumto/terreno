"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface TaskDetail {
  task_id: string;
  type: "verify_place" | "check_price" | "translate";
  status: string;
  input: Record<string, unknown>;
  price_usdc: number;
  deadline_at: string;
  claim_expires_at: string | null;
  is_own_claim: boolean;
}

type ViewState = "loading" | "ready" | "not_signed_in" | "not_found" | "error";
type ClaimState = "idle" | "claiming" | "error";
type SubmitState = "idle" | "submitting" | "error";

export default function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [task, setTask] = useState<TaskDetail | null>(null);
  const [view, setView] = useState<ViewState>("loading");
  const [claimState, setClaimState] = useState<ClaimState>("idle");
  const [claimError, setClaimError] = useState<string | null>(null);
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function loadTask() {
    const res = await fetch(`/api/worker/tasks/${id}`);
    if (res.status === 401) {
      setView("not_signed_in");
      return;
    }
    if (res.status === 404) {
      setView("not_found");
      return;
    }
    if (!res.ok) {
      setView("error");
      return;
    }
    setTask(await res.json());
    setView("ready");
  }

  useEffect(() => {
    void Promise.resolve().then(loadTask);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleClaim() {
    setClaimError(null);
    setClaimState("claiming");
    try {
      const res = await fetch(`/api/worker/tasks/${id}/claim`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(claimErrorMessage(body.error, body.status));
      }
      await loadTask();
      setClaimState("idle");
    } catch (err) {
      setClaimState("error");
      setClaimError(err instanceof Error ? err.message : "Could not claim this task.");
    }
  }

  async function handleSubmit(answer: Record<string, unknown>, photoKey?: string) {
    setSubmitError(null);
    setSubmitState("submitting");
    try {
      const res = await fetch(`/api/worker/tasks/${id}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answer, ...(photoKey ? { photo_key: photoKey } : {}) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(submitErrorMessage(body.error));
      }
      router.push(`/work/${id}/done`);
    } catch (err) {
      setSubmitState("error");
      setSubmitError(err instanceof Error ? err.message : "Could not submit your answer.");
    }
  }

  if (view === "not_signed_in") {
    return (
      <main className="mx-auto max-w-md px-4 py-8 text-center">
        <p className="text-neutral-700">You need to sign in first.</p>
        <Link href="/join" className="mt-4 inline-block text-blue-600 underline">
          Go to sign in
        </Link>
      </main>
    );
  }

  if (view === "not_found") {
    return (
      <main className="mx-auto max-w-md px-4 py-8 text-center">
        <p className="text-neutral-700">This task isn&apos;t available anymore.</p>
        <Link href="/work" className="mt-4 inline-block text-blue-600 underline">
          Back to open tasks
        </Link>
      </main>
    );
  }

  if (view === "error" || !task) {
    return (
      <main className="mx-auto max-w-md px-4 py-8 text-center text-neutral-500">
        {view === "loading" ? "Loading…" : "Something went wrong. Reload and try again."}
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <TaskSummary task={task} />

      {task.status === "open" && !task.is_own_claim && (
        <div className="mt-6">
          <button
            type="button"
            onClick={handleClaim}
            disabled={claimState === "claiming"}
            className="w-full rounded-md bg-neutral-900 px-4 py-2 text-white disabled:opacity-50"
          >
            {claimState === "claiming" ? "Claiming…" : "Claim this task"}
          </button>
          {claimError && <p className="mt-2 text-sm text-red-600">{claimError}</p>}
        </div>
      )}

      {task.status === "claimed" && task.is_own_claim && (
        <AnswerForm
          type={task.type}
          onSubmit={handleSubmit}
          submitting={submitState === "submitting"}
          error={submitError}
        />
      )}

      {task.status === "claimed" && !task.is_own_claim && (
        <p className="mt-6 text-sm text-neutral-500">Someone else is already working on this.</p>
      )}

      {(task.status === "submitted" || task.status === "completed") && (
        <p className="mt-6 text-sm text-neutral-500">
          You already answered this one. {task.status === "completed" ? "Paid." : "Payment is processing."}
        </p>
      )}
    </main>
  );
}

function minutesUntil(iso: string): number {
  return Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
}

function TaskSummary({ task }: { task: TaskDetail }) {
  return (
    <div>
      <h1 className="text-xl font-semibold text-neutral-900">{taskTitle(task)}</h1>
      <div className="mt-2 flex items-center justify-between">
        <p className="text-sm text-neutral-500">
          {minutesUntil(task.deadline_at) > 0
            ? `${minutesUntil(task.deadline_at)} min left`
            : "Deadline passed"}
        </p>
        <p className="text-sm font-semibold text-neutral-900">{task.price_usdc.toFixed(2)} USDC</p>
      </div>
    </div>
  );
}

function taskTitle(task: TaskDetail): string {
  switch (task.type) {
    case "verify_place":
      return String(task.input.question ?? task.input.place_name ?? "Verify this place");
    case "check_price":
      return `Check the price of ${String(task.input.item ?? "this item")}`;
    case "translate":
      return `Translate to ${String(task.input.target_language ?? "another language")}`;
  }
}

function AnswerForm({
  type,
  onSubmit,
  submitting,
  error,
}: {
  type: TaskDetail["type"];
  onSubmit: (answer: Record<string, unknown>, photoKey?: string) => void;
  submitting: boolean;
  error: string | null;
}) {
  if (type === "verify_place") return <VerifyPlaceForm onSubmit={onSubmit} submitting={submitting} error={error} />;
  if (type === "check_price") return <CheckPriceForm onSubmit={onSubmit} submitting={submitting} error={error} />;
  return <TranslateForm onSubmit={onSubmit} submitting={submitting} error={error} />;
}

function PhotoStub() {
  return (
    <p className="rounded-md bg-amber-50 p-3 text-xs text-amber-800">
      Photo upload isn&apos;t available yet. Submitting without one for now.
    </p>
  );
}

function VerifyPlaceForm({
  onSubmit,
  submitting,
  error,
}: {
  onSubmit: (answer: Record<string, unknown>) => void;
  submitting: boolean;
  error: string | null;
}) {
  const [exists, setExists] = useState<"yes" | "no">("yes");
  const [openNow, setOpenNow] = useState<"yes" | "no" | "cant_tell">("yes");
  const [notes, setNotes] = useState("");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ exists, open_now: openNow, notes: notes || undefined });
      }}
      className="mt-6 space-y-4"
    >
      <RadioField label="Does it exist?" value={exists} onChange={setExists} options={["yes", "no"]} />
      <RadioField
        label="Open now?"
        value={openNow}
        onChange={setOpenNow}
        options={["yes", "no", "cant_tell"]}
      />
      <NotesField value={notes} onChange={setNotes} />
      <PhotoStub />
      <SubmitButton submitting={submitting} error={error} />
    </form>
  );
}

function CheckPriceForm({
  onSubmit,
  submitting,
  error,
}: {
  onSubmit: (answer: Record<string, unknown>) => void;
  submitting: boolean;
  error: string | null;
}) {
  const [found, setFound] = useState<"yes" | "no">("yes");
  const [price, setPrice] = useState("");
  const [inStock, setInStock] = useState<"yes" | "no" | "cant_tell">("yes");
  const [notes, setNotes] = useState("");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const parsedPrice = price.trim() ? Number(price) : undefined;
        onSubmit({
          found,
          price: parsedPrice,
          in_stock: inStock,
          notes: notes || undefined,
        });
      }}
      className="mt-6 space-y-4"
    >
      <RadioField label="Found it?" value={found} onChange={setFound} options={["yes", "no"]} />
      <label className="block">
        <span className="mb-1 block text-sm text-neutral-700">Price</span>
        <input
          type="number"
          step="0.01"
          min="0"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          className="w-full rounded-md border border-neutral-300 px-3 py-2"
        />
      </label>
      <RadioField
        label="In stock?"
        value={inStock}
        onChange={setInStock}
        options={["yes", "no", "cant_tell"]}
      />
      <NotesField value={notes} onChange={setNotes} />
      <PhotoStub />
      <SubmitButton submitting={submitting} error={error} />
    </form>
  );
}

function TranslateForm({
  onSubmit,
  submitting,
  error,
}: {
  onSubmit: (answer: Record<string, unknown>) => void;
  submitting: boolean;
  error: string | null;
}) {
  const [translation, setTranslation] = useState("");
  const [notes, setNotes] = useState("");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ translation, notes: notes || undefined });
      }}
      className="mt-6 space-y-4"
    >
      <label className="block">
        <span className="mb-1 block text-sm text-neutral-700">Translation</span>
        <textarea
          required
          value={translation}
          onChange={(e) => setTranslation(e.target.value)}
          rows={4}
          className="w-full rounded-md border border-neutral-300 px-3 py-2"
        />
      </label>
      <NotesField label="Notes on register or alternatives" value={notes} onChange={setNotes} />
      <SubmitButton submitting={submitting} error={error} />
    </form>
  );
}

function RadioField<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: T[];
}) {
  return (
    <div>
      <span className="mb-1 block text-sm text-neutral-700">{label}</span>
      <div className="flex gap-2">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            className={`rounded-md border px-3 py-1.5 text-sm ${
              value === option
                ? "border-neutral-900 bg-neutral-900 text-white"
                : "border-neutral-300 text-neutral-700"
            }`}
          >
            {optionLabel(option)}
          </button>
        ))}
      </div>
    </div>
  );
}

function optionLabel(option: string): string {
  return option === "cant_tell" ? "Can't tell" : option[0]?.toUpperCase() + option.slice(1);
}

function NotesField({
  label = "Notes (optional)",
  value,
  onChange,
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-neutral-700">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={300}
        rows={3}
        className="w-full rounded-md border border-neutral-300 px-3 py-2"
      />
    </label>
  );
}

function SubmitButton({ submitting, error }: { submitting: boolean; error: string | null }) {
  return (
    <>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-md bg-neutral-900 px-4 py-2 text-white disabled:opacity-50"
      >
        {submitting ? "Submitting…" : "Submit answer"}
      </button>
    </>
  );
}

function claimErrorMessage(code: string | undefined, status: string | undefined): string {
  switch (code) {
    case "not_open":
      return status ? `This task is no longer open (${status}).` : "This task is no longer open.";
    case "already_claimed":
      return "Someone else just claimed this task.";
    case "already_holding_a_claim":
      return "You already have an active claim on another task.";
    case "language_mismatch":
      return "This task needs a language you haven't listed.";
    case "try_again":
      return "Could not claim this task. Try again.";
    default:
      return "Could not claim this task. Try again.";
  }
}

function submitErrorMessage(code: string | undefined): string {
  switch (code) {
    case "not_your_claim":
      return "This task isn't claimed by you anymore.";
    case "deadline_passed":
      return "The deadline for this task has passed.";
    case "invalid_answer":
      return "Check your answer and try again.";
    case "photo_required_not_yet_available":
      return "A photo is required for this task type, and upload isn't available yet.";
    default:
      return "Could not submit your answer. Try again.";
  }
}
