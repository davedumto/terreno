import { NextRequest } from "next/server";
import { translateSchema, TASK_PRICES_STROOPS } from "@terreno/shared";
import { createPaidTask } from "@/lib/create-paid-task";

export async function POST(req: NextRequest): Promise<Response> {
  return createPaidTask(req, {
    type: "translate",
    schema: translateSchema,
    amountStroops: TASK_PRICES_STROOPS.translate,
    routeKey: "translate",
    description:
      "A native speaker translates short text naturally for local context, no photo needed. Answer within your deadline or automatic refund.",
  });
}
