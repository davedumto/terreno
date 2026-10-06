"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

export default function AdminLoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(loginErrorMessage(body.error));
      }
      router.push("/admin");
    } catch (err) {
      setSubmitting(false);
      setError(err instanceof Error ? err.message : "Could not sign in. Try again.");
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <p className="font-mono text-[.75rem] font-bold uppercase tracking-[.22em] text-muted2">
        Terreno ops
      </p>
      <h1 className="mt-1 font-display text-[1.75rem] font-extrabold tracking-[-0.01em] text-ink">
        Admin <em className="font-serif italic font-semibold tracking-[-0.02em] text-forest">sign in.</em>
      </h1>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <Input
          label="Password"
          type="password"
          required
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={error}
        />
        <Button type="submit" variant="sun" disabled={submitting || !password} className="w-full">
          {submitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </main>
  );
}

function loginErrorMessage(code: string | undefined): string {
  switch (code) {
    case "invalid_password":
      return "That password isn't right.";
    case "bad_origin":
      return "Request blocked. Reload the page and try again.";
    default:
      return "Could not sign in. Try again.";
  }
}
