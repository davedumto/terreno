import { NextRequest } from "next/server";
import { verifyPlaceSchema, TASK_PRICES_STROOPS } from "@terreno/shared";
import { createPaidTask } from "@/lib/create-paid-task";

export async function POST(req: NextRequest): Promise<Response> {
  return createPaidTask(req, {
    type: "verify_place",
    schema: verifyPlaceSchema,
    amountStroops: TASK_PRICES_STROOPS.verify_place,
    routeKey: "verify-place",
    description:
      "A local person checks whether a place exists and is open, with a photo. Answer within your deadline or automatic refund.",
  });
}
