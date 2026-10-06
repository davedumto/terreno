import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { APPROX_USD_TO_LOCAL, STROOPS_PER_USDC } from "@terreno/shared";
import { db } from "@/lib/db";
import { tasks, workers } from "@/lib/db/schema";
import { getSession } from "@/lib/session";
import { computeReputationScore } from "@/lib/reputation";
import { getUsdcBalance } from "@/lib/usdc";

function stroopsToUsdc(stroops: number): number {
  return stroops / STROOPS_PER_USDC;
}

export async function GET(req: NextRequest): Promise<Response> {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }

  const [worker] = await db.select().from(workers).where(eq(workers.id, session.workerId));
  if (!worker) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }

  const [reputation, balanceStroops, completedTasks] = await Promise.all([
    computeReputationScore(db, worker.id),
    getUsdcBalance(worker.walletAddress).catch((err) => {
      console.error("getUsdcBalance failed", err);
      return null;
    }),
    db
      .select()
      .from(tasks)
      .where(eq(tasks.workerId, worker.id))
      .orderBy(desc(tasks.updatedAt)),
  ]);

  const earnings = completedTasks
    .filter((task) => task.status === "completed" && task.releaseTxHash)
    .map((task) => {
      const paidStroops = task.price - task.fee;
      return {
        task_id: task.id,
        type: task.type,
        paid_usdc: stroopsToUsdc(paidStroops),
        release_tx: `https://stellar.expert/explorer/testnet/tx/${task.releaseTxHash}`,
        completed_at: new Date(task.updatedAt).toISOString(),
      };
    });

  // worker.country has no DB-level CHECK (unlike status/type/kind columns),
  // so this guards against a value outside NG/CL/CR rather than trusting
  // the zod validation at /join always ran.
  const localRate =
    worker.country in APPROX_USD_TO_LOCAL
      ? APPROX_USD_TO_LOCAL[worker.country as keyof typeof APPROX_USD_TO_LOCAL]
      : null;

  return NextResponse.json({
    display_name: worker.displayName,
    country: worker.country,
    city: worker.city,
    status: worker.status,
    score: reputation.score,
    completed_tasks: reputation.completedTasks,
    balance: balanceStroops === null
      ? { usdc: null, error: "unavailable" }
      : {
          usdc: stroopsToUsdc(Number(balanceStroops)),
          approx_local: localRate
            ? {
                amount: stroopsToUsdc(Number(balanceStroops)) * localRate.rate,
                currency: localRate.currency,
              }
            : null,
        },
    earnings,
    cash_out: { available: false, note: "Cash out is not available yet." },
  });
}
