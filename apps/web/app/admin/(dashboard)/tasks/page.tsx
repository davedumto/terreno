"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/admin/PageHeader";
import { TableCard, type AdminTaskRow } from "@/components/admin/TableCard";
import { Chip } from "@/components/ui/Chip";
import { Button } from "@/components/ui/Button";
import type { TaskStatus } from "@/components/ui/StatusPill";

const STATUS_FILTERS: { label: string; statuses: TaskStatus[] }[] = [
  { label: "All", statuses: [] },
  { label: "Completed", statuses: ["completed"] },
  { label: "Pending", statuses: ["open", "claimed", "paid", "submitted"] },
  { label: "Refunded", statuses: ["refunded"] },
];

const PAGE_SIZE = 20;

export default function AdminTasksPage() {
  return (
    <Suspense>
      <AdminTasksPageContent />
    </Suspense>
  );
}

function AdminTasksPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeStatuses = searchParams.getAll("status");
  const page = Number(searchParams.get("page") ?? "1");

  const [tasks, setTasks] = useState<AdminTaskRow[] | null>(null);
  const [totalCount, setTotalCount] = useState(0);

  useEffect(() => {
    void Promise.resolve().then(async () => {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", String(PAGE_SIZE));
      for (const status of activeStatuses) params.append("status", status);

      setTasks(null);
      const res = await fetch(`/api/admin/tasks?${params}`);
      const body = await res.json();
      setTasks(body.tasks);
      setTotalCount(body.totalCount);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.toString()]);

  function selectFilter(statuses: TaskStatus[]) {
    const params = new URLSearchParams();
    for (const status of statuses) params.append("status", status);
    router.push(`/admin/tasks${params.toString() ? `?${params}` : ""}`);
  }

  function goToPage(nextPage: number) {
    const params = new URLSearchParams(searchParams);
    params.set("page", String(nextPage));
    router.push(`/admin/tasks?${params}`);
  }

  const isFilterActive = (statuses: TaskStatus[]) =>
    statuses.length === activeStatuses.length && statuses.every((s) => activeStatuses.includes(s));

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <>
      <PageHeader
        eyebrow="Terreno ops · Testnet"
        title="Tasks"
        lead="Every task paid for through the platform, agent to worker."
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {STATUS_FILTERS.map((filter) => (
          <Chip
            key={filter.label}
            selected={isFilterActive(filter.statuses)}
            onClick={() => selectFilter(filter.statuses)}
          >
            {filter.label}
          </Chip>
        ))}
      </div>

      {tasks && (
        <TableCard
          tasks={tasks}
          footer={
            totalPages > 1 ? (
              <>
                <span className="text-sm text-muted">
                  Page {page} of {totalPages}
                </span>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => goToPage(page - 1)}
                  >
                    Previous
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => goToPage(page + 1)}
                  >
                    Next
                  </Button>
                </div>
              </>
            ) : (
              <span className="text-sm text-muted">{totalCount} total</span>
            )
          }
        />
      )}
    </>
  );
}
