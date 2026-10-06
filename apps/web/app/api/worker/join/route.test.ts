import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const submitWalletDeployMock = vi.fn(async (..._args: unknown[]) => ({ txHash: "a".repeat(64) }));

vi.mock("@/lib/worker-wallet", async () => {
  const actual = await vi.importActual<typeof import("@/lib/worker-wallet")>("@/lib/worker-wallet");
  return {
    ...actual,
    submitWalletDeploy: (...args: unknown[]) => submitWalletDeployMock(...args),
  };
});

const { POST } = await import("./route");

const APP_URL = "http://localhost:3000";
const INVITE_CODE = "the-real-invite-code";
const VALID_BODY = {
  invite_code: INVITE_CODE,
  contract_id: "C" + "A".repeat(55),
  signed_tx: "AAAAAgAAAAA=",
};

beforeEach(() => {
  vi.stubEnv("APP_URL", APP_URL);
  vi.stubEnv("INVITE_CODE", INVITE_CODE);
  submitWalletDeployMock.mockReset();
  submitWalletDeployMock.mockResolvedValue({ txHash: "a".repeat(64) });
});

function joinRequest(body: unknown, options: { origin?: string } = {}): NextRequest {
  return new NextRequest(`${APP_URL}/api/worker/join`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(options.origin === undefined ? { origin: APP_URL } : options.origin ? { origin: options.origin } : {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/worker/join", () => {
  it("submits the wallet deploy and returns the real tx hash", async () => {
    const res = await POST(joinRequest(VALID_BODY));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.creation_tx_hash).toBe("a".repeat(64));
    expect(submitWalletDeployMock).toHaveBeenCalledWith(VALID_BODY.signed_tx);
  });

  it("rejects a request with no Origin header", async () => {
    const res = await POST(joinRequest(VALID_BODY, { origin: "" }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("bad_origin");
    expect(submitWalletDeployMock).not.toHaveBeenCalled();
  });

  it("rejects a request from a different Origin", async () => {
    const res = await POST(joinRequest(VALID_BODY, { origin: "http://evil.example" }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("bad_origin");
  });

  it("rejects malformed JSON before any invite check or deploy work", async () => {
    const res = await POST(joinRequest("not json"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_input");
    expect(submitWalletDeployMock).not.toHaveBeenCalled();
  });

  it("rejects a body missing required fields", async () => {
    const res = await POST(joinRequest({ invite_code: INVITE_CODE }));
    expect(res.status).toBe(400);
  });

  it("rejects the wrong invite code without attempting a deploy", async () => {
    const res = await POST(joinRequest({ ...VALID_BODY, invite_code: "wrong-code" }));

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("invalid_invite_code");
    expect(submitWalletDeployMock).not.toHaveBeenCalled();
  });

  it("rejects an invite code of a different length without attempting a deploy", async () => {
    const res = await POST(joinRequest({ ...VALID_BODY, invite_code: "short" }));

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("invalid_invite_code");
    expect(submitWalletDeployMock).not.toHaveBeenCalled();
  });

  it("returns 502 deploy_failed when submission fails, not a 500", async () => {
    const { WalletDeploySubmissionError } = await import("@/lib/worker-wallet");
    submitWalletDeployMock.mockRejectedValue(
      new WalletDeploySubmissionError("the network rejected it"),
    );

    const res = await POST(joinRequest(VALID_BODY));

    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("deploy_failed");
  });

  it("rethrows an unexpected error rather than reporting deploy_failed", async () => {
    submitWalletDeployMock.mockRejectedValue(new Error("something else entirely"));

    await expect(POST(joinRequest(VALID_BODY))).rejects.toThrow("something else entirely");
  });
});
