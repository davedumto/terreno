import { afterEach, describe, expect, it, vi } from "vitest";
import { requireEnv } from "./env";

describe("requireEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the value when set", () => {
    vi.stubEnv("SOME_VAR", "a-value");
    expect(requireEnv("SOME_VAR")).toBe("a-value");
  });

  it("throws naming the variable when unset", () => {
    vi.stubEnv("SOME_VAR", "");
    expect(() => requireEnv("SOME_VAR")).toThrow("SOME_VAR is not set");
  });

  it("never includes the value in the thrown message", () => {
    vi.stubEnv("SECRET_VAR", "");
    try {
      requireEnv("SECRET_VAR");
    } catch (error) {
      expect((error as Error).message).toBe("SECRET_VAR is not set");
    }
  });
});
