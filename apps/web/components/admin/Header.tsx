"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";

export function Header() {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function handleLogout() {
    setSigningOut(true);
    await fetch("/api/admin/logout", { method: "POST", headers: { "content-type": "application/json" } });
    router.push("/admin/login");
  }

  return (
    <header className="sticky top-0 z-10 flex h-[var(--shell-header-h)] items-center justify-between border-b border-line bg-[color-mix(in_srgb,var(--bg)_88%,transparent)] px-6 backdrop-blur-[12px]">
      <div className="flex items-center gap-3">
        <span className="font-display text-lg font-extrabold text-ink">Terreno</span>
        <span className="rounded-pill bg-chip px-3 py-1 font-mono text-[.6875rem] font-bold uppercase tracking-[.08em] text-muted">
          Testnet
        </span>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={handleLogout} disabled={signingOut}>
        {signingOut ? "Signing out…" : "Sign out"}
      </Button>
    </header>
  );
}
