import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const balanceMock = vi.fn(async (..._args: unknown[]) => ({ result: 0n }));
const fromMock = vi.fn(async (..._args: unknown[]) => ({
  balance: (...args: unknown[]) => balanceMock(...args),
}));

vi.mock("@stellar/stellar-sdk/contract", () => ({
  Client: { from: (...args: unknown[]) => fromMock(...args) },
}));

const { getUsdcBalance } = await import("./usdc");

const ADDRESS = "C" + "A".repeat(55);

describe("getUsdcBalance", () => {
  beforeEach(() => {
    vi.stubEnv("USDC_CONTRACT_ID", "CUSDCCONTRACTID");
    vi.stubEnv("STELLAR_RPC_URL", "https://soroban-testnet.stellar.org/");
    vi.stubEnv("STELLAR_NETWORK", "testnet");
    fromMock.mockClear();
    balanceMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the balance from the token contract's simulation result", async () => {
    balanceMock.mockResolvedValue({ result: 5_000_000n });

    const balance = await getUsdcBalance(ADDRESS);

    expect(balance).toBe(5_000_000n);
    expect(balanceMock).toHaveBeenCalledWith({ id: ADDRESS });
  });

  it("returns 0 for an address with no balance", async () => {
    balanceMock.mockResolvedValue({ result: 0n });

    const balance = await getUsdcBalance(ADDRESS);

    expect(balance).toBe(0n);
  });

  it("builds the client against the real testnet passphrase", async () => {
    balanceMock.mockResolvedValue({ result: 0n });

    await getUsdcBalance(ADDRESS);

    expect(fromMock).toHaveBeenCalledWith(
      expect.objectContaining({ networkPassphrase: "Test SDF Network ; September 2015" }),
    );
  });

  it("throws if STELLAR_NETWORK is not testnet", async () => {
    vi.stubEnv("STELLAR_NETWORK", "mainnet");

    await expect(getUsdcBalance(ADDRESS)).rejects.toThrow(/STELLAR_NETWORK must be "testnet"/);
  });

  it("throws if USDC_CONTRACT_ID is unset", async () => {
    vi.stubEnv("USDC_CONTRACT_ID", "");

    await expect(getUsdcBalance(ADDRESS)).rejects.toThrow("USDC_CONTRACT_ID is not set");
  });
});
