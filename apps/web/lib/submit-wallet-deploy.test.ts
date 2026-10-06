import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Account, Keypair, Operation, TransactionBuilder } from "@stellar/stellar-sdk";

const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
// Confirmed real export: @stellar/stellar-sdk/contract's NULL_ACCOUNT, the
// placeholder source passkey-kit's shared-deployer carrier is built against
// (see lib/worker-wallet.ts's own doc comment for the full context).
const NULL_ACCOUNT_ID = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

const adminKeypair = Keypair.random();
const ADMIN_SECRET = adminKeypair.secret();

/**
 * A real, genuinely-decodable NULL_ACCOUNT-sourced, zero-envelope-signature
 * transaction, shaped exactly like passkey-kit's createWallet() carrier
 * (confirmed empirically against the real deployed shape; see
 * docs/decisions.md, 2026-10-06). Uses a plain classic bumpSequence
 * operation rather than a real Soroban invoke-host-function, since building
 * a genuine simulated Soroban auth entry needs a live RPC round-trip; the
 * resourcing mechanism itself (decode -> extract raw op + sorobanData from
 * the raw envelope -> rebuild with a real source -> sign) doesn't care what
 * the operation actually is, only that there is exactly one.
 */
function buildCarrierXdr(): string {
  const nullAccount = new Account(NULL_ACCOUNT_ID, "0");
  const tx = new TransactionBuilder(nullAccount, { fee: "100", networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(Operation.bumpSequence({ bumpTo: "0" }))
    .setTimeout(30)
    .build();
  return tx.toXDR();
}

const getAccountMock = vi.fn();
const sendTransactionMock = vi.fn();
const pollTransactionMock = vi.fn();
// Real behavior: re-simulates the built transaction and returns it fully
// assembled with a corrected Soroban footprint (see worker-wallet.ts's doc
// comment on why this step is required, not optional). For this test
// suite's classic bumpSequence stand-in operation there is nothing Soroban
// to recompute, so the faithful mock is "returns the input unchanged" —
// the actual footprint-correctness fix is proven separately against a real
// Soroban auth entry on live testnet; see docs/decisions.md, 2026-10-06.
const prepareTransactionMock = vi.fn((...args: unknown[]) => Promise.resolve(args[0]));

vi.mock("@stellar/stellar-sdk/rpc", async () => {
  const actual = await vi.importActual<typeof import("@stellar/stellar-sdk/rpc")>("@stellar/stellar-sdk/rpc");
  return {
    ...actual,
    Server: class {
      getAccount(...args: unknown[]) {
        return getAccountMock(...args);
      }
      sendTransaction(...args: unknown[]) {
        return sendTransactionMock(...args);
      }
      pollTransaction(...args: unknown[]) {
        return pollTransactionMock(...args);
      }
      prepareTransaction(...args: unknown[]) {
        return prepareTransactionMock(...args);
      }
    },
  };
});

const { submitWalletDeploy, WalletDeploySubmissionError } = await import("./worker-wallet");

beforeEach(() => {
  vi.stubEnv("STELLAR_RPC_URL", "https://soroban-testnet.stellar.org/");
  vi.stubEnv("STELLAR_NETWORK", "testnet");
  vi.stubEnv("ADMIN_SECRET_KEY", ADMIN_SECRET);
  getAccountMock.mockReset();
  sendTransactionMock.mockReset();
  pollTransactionMock.mockReset();
  prepareTransactionMock.mockReset();
  getAccountMock.mockResolvedValue(new Account(adminKeypair.publicKey(), "100"));
  sendTransactionMock.mockResolvedValue({ status: "PENDING", hash: "a".repeat(64) });
  pollTransactionMock.mockResolvedValue({ status: "SUCCESS" });
  prepareTransactionMock.mockImplementation((...args: unknown[]) => Promise.resolve(args[0]));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("submitWalletDeploy", () => {
  it("resources the carrier to the admin account, signs, and submits it", async () => {
    const carrierXdr = buildCarrierXdr();

    const result = await submitWalletDeploy(carrierXdr);

    expect(result.txHash).toBe("a".repeat(64));
    expect(getAccountMock).toHaveBeenCalledWith(adminKeypair.publicKey());

    const submittedTx = sendTransactionMock.mock.calls[0]?.[0];
    expect(submittedTx.source).toBe(adminKeypair.publicKey());
    expect(submittedTx.signatures).toHaveLength(1);
    expect(submittedTx.operations).toHaveLength(1);
  });

  it("throws WalletDeploySubmissionError for malformed XDR", async () => {
    await expect(submitWalletDeploy("not-valid-base64-xdr")).rejects.toThrow(
      WalletDeploySubmissionError,
    );
    expect(sendTransactionMock).not.toHaveBeenCalled();
  });

  it("throws WalletDeploySubmissionError if the account cannot be loaded", async () => {
    getAccountMock.mockRejectedValue(new Error("account not found"));
    const carrierXdr = buildCarrierXdr();

    await expect(submitWalletDeploy(carrierXdr)).rejects.toThrow(WalletDeploySubmissionError);
  });

  it("throws WalletDeploySubmissionError when the network rejects the submission", async () => {
    sendTransactionMock.mockResolvedValue({
      status: "ERROR",
      hash: "b".repeat(64),
      errorResult: { fake: "error" },
    });
    const carrierXdr = buildCarrierXdr();

    await expect(submitWalletDeploy(carrierXdr)).rejects.toThrow(WalletDeploySubmissionError);
  });

  it("throws WalletDeploySubmissionError when the transaction does not reach SUCCESS", async () => {
    pollTransactionMock.mockResolvedValue({ status: "FAILED" });
    const carrierXdr = buildCarrierXdr();

    await expect(submitWalletDeploy(carrierXdr)).rejects.toThrow(WalletDeploySubmissionError);
  });

  it("preserves the operation's shape through the decode-and-rebuild", async () => {
    const carrierXdr = buildCarrierXdr();

    await submitWalletDeploy(carrierXdr);

    const submittedTx = sendTransactionMock.mock.calls[0]?.[0];
    expect(submittedTx.operations[0].type).toBe("bumpSequence");
  });

  it("re-simulates via prepareTransaction before signing, not the carrier's own stale Soroban data", async () => {
    // Capture the transaction's signature count at the moment prepareTransaction
    // is actually called, not after the test awaits submitWalletDeploy to
    // completion: the mock and the real code share the same object
    // reference, and .sign() mutates it in place afterward, so reading
    // .signatures only after everything has run would just show the
    // post-sign state regardless of call order.
    let signatureCountAtPrepareTime = -1;
    prepareTransactionMock.mockImplementation((...args: unknown[]) => {
      const tx = args[0] as { signatures: unknown[] };
      signatureCountAtPrepareTime = tx.signatures.length;
      return Promise.resolve(tx);
    });
    const carrierXdr = buildCarrierXdr();

    await submitWalletDeploy(carrierXdr);

    expect(prepareTransactionMock).toHaveBeenCalledTimes(1);
    expect(signatureCountAtPrepareTime).toBe(0); // unsigned when handed to prepareTransaction
    const unpreparedTx = prepareTransactionMock.mock.calls[0]?.[0] as { source: string };
    expect(unpreparedTx.source).toBe(adminKeypair.publicKey());
    // sendTransaction must receive prepareTransaction's output, signed, not
    // some other transaction built independently.
    const submittedTx = sendTransactionMock.mock.calls[0]?.[0];
    expect(submittedTx).toBe(unpreparedTx);
  });

  it("throws WalletDeploySubmissionError when re-simulation fails, without submitting", async () => {
    prepareTransactionMock.mockRejectedValue(new Error("simulation failed"));
    const carrierXdr = buildCarrierXdr();

    await expect(submitWalletDeploy(carrierXdr)).rejects.toThrow(WalletDeploySubmissionError);
    expect(sendTransactionMock).not.toHaveBeenCalled();
  });
});
