"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getPasskeyKit } from "@/lib/passkey-client";

const COUNTRIES = [
  { code: "NG", label: "Nigeria" },
  { code: "CL", label: "Chile" },
  { code: "CR", label: "Costa Rica" },
];

type Step = "form" | "creating_passkey" | "deploying" | "confirming" | "done" | "error";
type SigninStep = "idle" | "connecting" | "signing_in" | "error";

export default function JoinPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("form");
  const [error, setError] = useState<string | null>(null);
  const [inviteCode, setInviteCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [country, setCountry] = useState("NG");
  const [city, setCity] = useState("");
  const [languages, setLanguages] = useState("en");

  const [signinStep, setSigninStep] = useState<SigninStep>("idle");
  const [signinError, setSigninError] = useState<string | null>(null);

  async function handleSignin() {
    setSigninError(null);
    try {
      setSigninStep("connecting");
      const kit = getPasskeyKit();
      // Resolves the wallet from this browser's own local passkey storage
      // (no indexer configured): only works on the same device that ran
      // createWallet() + confirmWalletCreation() before. A different
      // device or a cleared browser has nothing to find here and throws,
      // same as "I don't have an account on this device yet."
      const connected = await kit.connectWallet();

      setSigninStep("signing_in");
      const res = await fetch("/api/worker/signin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contract_id: connected.contractId,
          key_id_base64: connected.keyIdBase64,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(signinErrorMessage(body.error));
      }

      router.push("/work");
    } catch (err) {
      setSigninStep("error");
      setSigninError(err instanceof Error ? err.message : "Could not sign in. Try again.");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const normalizedCity = city.trim().toLowerCase();
    const parsedLanguages = languages
      .split(",")
      .map((l) => l.trim().toLowerCase())
      .filter(Boolean);

    try {
      setStep("creating_passkey");
      const kit = getPasskeyKit();
      const created = await kit.createWallet("Terreno", displayName);

      setStep("deploying");
      const joinRes = await fetch("/api/worker/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          invite_code: inviteCode,
          contract_id: created.contractId,
          signed_tx: created.signedTx,
        }),
      });
      if (!joinRes.ok) {
        const body = await joinRes.json().catch(() => ({}));
        throw new Error(joinErrorMessage(body.error));
      }
      const { creation_tx_hash } = await joinRes.json();

      setStep("confirming");
      // Verifies the deployment on-chain and persists the passkey locally
      // (IndexedDBStorage), which connectWallet() needs later to sign in
      // without an indexer. If this throws, the wallet is real on-chain
      // but this browser never confirms or remembers it; retrying /join
      // from scratch with a fresh passkey is the accepted path for that
      // narrow window (see docs/decisions.md, 2026-10-06).
      await kit.confirmWalletCreation(created, creation_tx_hash);

      const confirmRes = await fetch("/api/worker/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contract_id: created.contractId,
          display_name: displayName,
          country,
          city: normalizedCity,
          languages: parsedLanguages,
          key_id_base64: created.keyIdBase64,
        }),
      });
      if (!confirmRes.ok) {
        const body = await confirmRes.json().catch(() => ({}));
        throw new Error(confirmErrorMessage(body.error));
      }

      setStep("done");
      router.push("/work");
    } catch (err) {
      setStep("error");
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    }
  }

  if (step === "done") {
    return (
      <main className="mx-auto max-w-md px-4 py-8 text-center">
        <p className="text-neutral-700">You&apos;re in. Taking you to open tasks…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <h1 className="text-xl font-semibold text-neutral-900">Join Terreno</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Your browser creates a passkey wallet. No app password, no seed phrase.
      </p>

      <div className="mt-6 rounded-lg border border-neutral-200 p-4">
        <p className="text-sm text-neutral-700">Already joined on this device?</p>
        <button
          type="button"
          onClick={handleSignin}
          disabled={signinStep === "connecting" || signinStep === "signing_in"}
          className="mt-2 w-full rounded-md border border-neutral-300 px-4 py-2 text-neutral-900 disabled:opacity-50"
        >
          {signinStatusLabel(signinStep)}
        </button>
        {signinError && <p className="mt-2 text-sm text-red-600">{signinError}</p>}
      </div>

      <div className="mt-6 flex items-center gap-3 text-xs text-neutral-400">
        <span className="h-px flex-1 bg-neutral-200" />
        new here
        <span className="h-px flex-1 bg-neutral-200" />
      </div>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <Field label="Invite code">
          <input
            required
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            className="w-full rounded-md border border-neutral-300 px-3 py-2"
          />
        </Field>

        <Field label="Your name">
          <input
            required
            maxLength={60}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full rounded-md border border-neutral-300 px-3 py-2"
          />
        </Field>

        <Field label="Country">
          <select
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className="w-full rounded-md border border-neutral-300 px-3 py-2"
          >
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="City">
          <input
            required
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="enugu"
            className="w-full rounded-md border border-neutral-300 px-3 py-2"
          />
        </Field>

        <Field label="Languages (comma-separated)">
          <input
            required
            value={languages}
            onChange={(e) => setLanguages(e.target.value)}
            placeholder="en, ig"
            className="w-full rounded-md border border-neutral-300 px-3 py-2"
          />
        </Field>

        <p className="text-xs text-neutral-500">
          By joining you agree to the <a href="/rules" className="underline">worker rules</a>.
        </p>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={step !== "form" && step !== "error"}
          className="w-full rounded-md bg-neutral-900 px-4 py-2 text-white disabled:opacity-50"
        >
          {statusLabel(step)}
        </button>
      </form>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-neutral-700">{label}</span>
      {children}
    </label>
  );
}

function statusLabel(step: Step): string {
  switch (step) {
    case "creating_passkey":
      return "Creating your passkey…";
    case "deploying":
      return "Setting up your wallet…";
    case "confirming":
      return "Confirming on-chain…";
    case "error":
      return "Try again";
    default:
      return "Join";
  }
}

function joinErrorMessage(code: string | undefined): string {
  switch (code) {
    case "invalid_invite_code":
      return "That invite code isn't valid.";
    case "bad_origin":
      return "Request blocked. Reload the page and try again.";
    case "deploy_failed":
      return "Could not set up your wallet. Try again.";
    default:
      return "Could not set up your wallet. Try again.";
  }
}

function confirmErrorMessage(code: string | undefined): string {
  switch (code) {
    case "wallet_verification_failed":
      return "Could not verify your wallet on-chain. Try again.";
    case "already_joined":
      return "You've already joined. Try signing in instead.";
    default:
      return "Could not finish joining. Try again.";
  }
}

function signinStatusLabel(step: SigninStep): string {
  switch (step) {
    case "connecting":
      return "Connecting…";
    case "signing_in":
      return "Signing in…";
    case "error":
      return "Try sign in again";
    default:
      return "Sign in with passkey";
  }
}

function signinErrorMessage(code: string | undefined): string {
  switch (code) {
    case "not_found":
      return "No account found for this passkey. Join below if you're new.";
    case "account_banned":
      return "This account has been suspended.";
    case "bad_origin":
      return "Request blocked. Reload the page and try again.";
    default:
      return "Could not sign in. Try again.";
  }
}
