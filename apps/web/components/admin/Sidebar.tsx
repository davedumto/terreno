"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { StatusHealthCard } from "@/components/admin/StatusHealthCard";

const NAV_ITEMS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/tasks", label: "Tasks" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-[248px] shrink-0 flex-col border-r border-line bg-bg2 p-4 lg:flex">
      <nav className="flex flex-1 flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`rounded-xl px-4 py-3 text-[15px] font-semibold transition-colors duration-150 ${
                active ? "border-l-[3px] border-lime bg-transparent pl-[13px] text-lime" : "text-muted hover:bg-chip"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <StatusHealthCard status="operational" label="Operational" />
    </aside>
  );
}
