import { HTTPFacilitatorClient, x402HTTPResourceServer, x402ResourceServer } from "@x402/core/server";
import type { ResourceConfig, RouteConfig } from "@x402/core/server";
import type { PaymentPayload, PaymentRequirements, SettleResponse } from "@x402/core/types";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import { NextAdapter } from "@x402/next";
import type { NextRequest } from "next/server";

export const STELLAR_TESTNET_NETWORK = "stellar:testnet";

let serverPromise: Promise<x402ResourceServer> | null = null;
const httpServersByRoutePath = new Map<string, Promise<x402HTTPResourceServer>>();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

/**
 * Lazily builds and initializes the shared x402ResourceServer, memoized per
 * process. initialize() hits the facilitator to confirm supported kinds, so
 * this only happens once, not on every request.
 */
async function getServer(): Promise<x402ResourceServer> {
  if (!serverPromise) {
    serverPromise = (async () => {
      const facilitatorClient = new HTTPFacilitatorClient({
        url: requireEnv("FACILITATOR_URL"),
      });
      const server = new x402ResourceServer(facilitatorClient).register(
        STELLAR_TESTNET_NETWORK,
        new ExactStellarScheme(),
      );
      await server.initialize();
      return server;
    })();
  }
  return serverPromise;
}

/**
 * Memoized per route path (keyed by resource description, which is stable
 * per call site), so x402HTTPResourceServer.initialize() -- which calls
 * through to x402ResourceServer.initialize() and re-fetches supported
 * kinds from the facilitator over the network every time it runs -- only
 * runs once per route per process, not once per request.
 */
async function getHttpServer(
  routeKey: string,
  routeConfig: RouteConfig,
): Promise<x402HTTPResourceServer> {
  let httpServerPromise = httpServersByRoutePath.get(routeKey);
  if (!httpServerPromise) {
    httpServerPromise = (async () => {
      const server = await getServer();
      const httpServer = new x402HTTPResourceServer(server, { "*": routeConfig });
      await httpServer.initialize();
      return httpServer;
    })();
    httpServersByRoutePath.set(routeKey, httpServerPromise);
  }
  return httpServerPromise;
}

export interface PaidRouteContext {
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirements;
}

/**
 * Processes an incoming request against x402's protocol machinery (build
 * the 402 response, verify a provided payment) WITHOUT settling.
 *
 * Deliberately does not use @x402/next's withX402, which settles payment
 * only after the route handler returns, by mutating the handler's response
 * with settlement headers. SPEC.md section 6's 201 response needs the
 * settlement tx hash inside the JSON body, which is only knowable after
 * settlement; handlers using this helper settle themselves, after their
 * own business logic succeeds, and build their own response body with the
 * real hash in it. See docs/decisions.md, 2026-10-05.
 */
export async function processX402Request(
  req: NextRequest,
  routeKey: string,
  routeConfig: RouteConfig,
): Promise<
  | { kind: "no-payment-required" }
  | { kind: "payment-error"; response: Response }
  | (PaidRouteContext & {
      kind: "payment-verified";
      settle: () => Promise<SettleResponse>;
    })
> {
  const server = await getServer();
  const httpServer = await getHttpServer(routeKey, routeConfig);

  const adapter = new NextAdapter(req);
  const result = await httpServer.processHTTPRequest({
    adapter,
    path: req.nextUrl.pathname,
    method: req.method,
    paymentHeader:
      req.headers.get("payment-signature") ?? req.headers.get("x-payment") ?? undefined,
  });

  if (result.type === "no-payment-required") {
    return { kind: "no-payment-required" };
  }

  if (result.type === "payment-error") {
    const { response } = result;
    const body = response.isHtml ? response.body : JSON.stringify(response.body ?? {});
    return {
      kind: "payment-error",
      response: new Response(body as BodyInit, {
        status: response.status,
        headers: response.headers,
      }),
    };
  }

  return {
    kind: "payment-verified",
    paymentPayload: result.paymentPayload,
    paymentRequirements: result.paymentRequirements,
    settle: () => server.settlePayment(result.paymentPayload, result.paymentRequirements),
  };
}

/** Builds a ResourceConfig for a verify-place style paid route. */
export function resourceConfigFor(opts: {
  payTo: string;
  amountStroops: number;
  asset: string;
  maxTimeoutSeconds?: number;
}): ResourceConfig {
  return {
    scheme: "exact",
    network: STELLAR_TESTNET_NETWORK,
    payTo: opts.payTo,
    price: { asset: opts.asset, amount: String(opts.amountStroops) },
    maxTimeoutSeconds: opts.maxTimeoutSeconds ?? 120,
  };
}
