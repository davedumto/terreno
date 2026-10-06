import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const EXPECTED_HASH = "97ce047884106b1c6c3bb40b8973cc48db1c4dad95c9e20462bf2c701daa764e";
const CONTRACT_ID = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const getContractInstanceMock = vi.fn();

vi.mock("@stellar/stellar-sdk/rpc", () => ({
  Server: class {
    getContractInstance(...args: unknown[]) {
      return getContractInstanceMock(...args);
    }
  },
}));

const { verifyWorkerWallet, WalletVerificationError } = await import("./worker-wallet");

// Mirrors @stellar/stellar-sdk@16.3.1's real js-xdr union shape: methods,
// not properties (executable(), switch(), wasmHash()).
function wasmInstance(wasmHashHex: string) {
  return {
    executable: () => ({
      switch: () => ({ name: "contractExecutableWasm" }),
      wasmHash: () => Buffer.from(wasmHashHex, "hex"),
    }),
  };
}

function stellarAssetInstance() {
  return {
    executable: () => ({
      switch: () => ({ name: "contractExecutableStellarAsset" }),
    }),
  };
}

describe("verifyWorkerWallet", () => {
  beforeEach(() => {
    vi.stubEnv("STELLAR_RPC_URL", "https://soroban-testnet.stellar.org/");
    vi.stubEnv("WORKER_WALLET_WASM_HASH", EXPECTED_HASH);
    getContractInstanceMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("resolves when the contract runs exactly the expected wasm hash", async () => {
    getContractInstanceMock.mockResolvedValue(wasmInstance(EXPECTED_HASH));

    await expect(verifyWorkerWallet(CONTRACT_ID)).resolves.toBeUndefined();
  });

  it("is case-insensitive when comparing wasm hashes", async () => {
    getContractInstanceMock.mockResolvedValue(wasmInstance(EXPECTED_HASH.toUpperCase()));

    await expect(verifyWorkerWallet(CONTRACT_ID)).resolves.toBeUndefined();
  });

  it("throws WalletVerificationError for a mismatched wasm hash", async () => {
    getContractInstanceMock.mockResolvedValue(
      wasmInstance("0000000000000000000000000000000000000000000000000000000000000000".slice(0, 64)),
    );

    await expect(verifyWorkerWallet(CONTRACT_ID)).rejects.toThrow(WalletVerificationError);
  });

  it("throws WalletVerificationError for a non-wasm executable (e.g. Stellar Asset Contract)", async () => {
    getContractInstanceMock.mockResolvedValue(stellarAssetInstance());

    await expect(verifyWorkerWallet(CONTRACT_ID)).rejects.toThrow(WalletVerificationError);
  });

  it("throws WalletVerificationError (not a raw RPC error) when the contract cannot be read", async () => {
    getContractInstanceMock.mockRejectedValue(new Error("contract instance not found"));

    await expect(verifyWorkerWallet(CONTRACT_ID)).rejects.toThrow(WalletVerificationError);
  });

  it("includes the contract id in the error message on mismatch", async () => {
    getContractInstanceMock.mockResolvedValue(wasmInstance("ff".repeat(32)));

    await expect(verifyWorkerWallet(CONTRACT_ID)).rejects.toThrow(
      new RegExp(CONTRACT_ID.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  });
});
