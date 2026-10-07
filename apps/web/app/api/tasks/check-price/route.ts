import { NextRequest } from "next/server";
import { checkPriceSchema, TASK_PRICES_STROOPS } from "@terreno/shared";
import { createPaidTask } from "@/lib/create-paid-task";

export async function POST(req: NextRequest): Promise<Response> {
  return createPaidTask(req, {
    type: "check_price",
    schema: checkPriceSchema,
    amountStroops: TASK_PRICES_STROOPS.check_price,
    routeKey: "check-price",
    description:
      "A local person checks the real price and stock of an item at a place, with a photo. Answer within your deadline or automatic refund.",
  });
}
