import { describe, expect, it } from "vitest";
import { workerConfirmSchema, workerJoinSchema } from "./worker-schemas";

const VALID_JOIN = {
  invite_code: "secret123",
  contract_id: "C" + "A".repeat(55),
  signed_tx: "AAAAAgAAAAA=",
};

const VALID_CONFIRM = {
  contract_id: "C" + "A".repeat(55),
  display_name: "Chidi",
  country: "NG",
  city: "enugu",
  languages: ["en", "ig"],
  key_id_base64: "YWJjZGVmZ2g",
};

describe("workerJoinSchema", () => {
  it("accepts a fully valid body", () => {
    expect(workerJoinSchema.safeParse(VALID_JOIN).success).toBe(true);
  });

  it("rejects a missing invite_code", () => {
    const { invite_code, ...rest } = VALID_JOIN;
    expect(workerJoinSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects a contract_id that doesn't start with C", () => {
    const result = workerJoinSchema.safeParse({ ...VALID_JOIN, contract_id: "G" + "A".repeat(55) });
    expect(result.success).toBe(false);
  });

  it("rejects a contract_id of the wrong length", () => {
    const result = workerJoinSchema.safeParse({ ...VALID_JOIN, contract_id: "CAAA" });
    expect(result.success).toBe(false);
  });

  it("rejects a missing signed_tx", () => {
    const { signed_tx, ...rest } = VALID_JOIN;
    expect(workerJoinSchema.safeParse(rest).success).toBe(false);
  });
});

describe("workerConfirmSchema", () => {
  it("accepts a fully valid body", () => {
    expect(workerConfirmSchema.safeParse(VALID_CONFIRM).success).toBe(true);
  });

  it("rejects an unsupported country", () => {
    const result = workerConfirmSchema.safeParse({ ...VALID_CONFIRM, country: "US" });
    expect(result.success).toBe(false);
  });

  it("rejects an uppercase city", () => {
    const result = workerConfirmSchema.safeParse({ ...VALID_CONFIRM, city: "Enugu" });
    expect(result.success).toBe(false);
  });

  it("rejects an empty languages array", () => {
    const result = workerConfirmSchema.safeParse({ ...VALID_CONFIRM, languages: [] });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed language code", () => {
    const result = workerConfirmSchema.safeParse({ ...VALID_CONFIRM, languages: ["english"] });
    expect(result.success).toBe(false);
  });

  it("accepts 3-letter language codes", () => {
    const result = workerConfirmSchema.safeParse({ ...VALID_CONFIRM, languages: ["ibo"] });
    expect(result.success).toBe(true);
  });

  it("rejects a display_name over 60 characters", () => {
    const result = workerConfirmSchema.safeParse({ ...VALID_CONFIRM, display_name: "x".repeat(61) });
    expect(result.success).toBe(false);
  });

  it("rejects an empty display_name", () => {
    const result = workerConfirmSchema.safeParse({ ...VALID_CONFIRM, display_name: "" });
    expect(result.success).toBe(false);
  });

  it("does not require invite_code or signed_tx (join-only fields)", () => {
    expect("invite_code" in workerConfirmSchema.shape).toBe(false);
    expect("signed_tx" in workerConfirmSchema.shape).toBe(false);
  });
});
