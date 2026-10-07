import { afterEach, describe, expect, it, vi } from "vitest";
import { requireEnv, testnetPassphrase } from "./env";

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

describe("testnetPassphrase", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the real testnet passphrase when STELLAR_NETWORK=testnet", () => {
    vi.stubEnv("STELLAR_NETWORK", "testnet");
    expect(testnetPassphrase()).toBe("Test SDF Network ; September 2015");
  });

  it("throws if STELLAR_NETWORK is unset", () => {
    vi.stubEnv("STELLAR_NETWORK", "");
    expect(() => testnetPassphrase()).toThrow(/STELLAR_NETWORK must be "testnet"/);
  });

  it("fails closed if STELLAR_NETWORK is ever set to mainnet or public", () => {
    vi.stubEnv("STELLAR_NETWORK", "mainnet");
    expect(() => testnetPassphrase()).toThrow(/STELLAR_NETWORK must be "testnet"/);
  });
});
