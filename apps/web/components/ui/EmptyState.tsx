interface EmptyStateProps {
  heading: React.ReactNode;
  body: string;
  action?: React.ReactNode;
}

export function EmptyState({ heading, body, action }: EmptyStateProps) {
  return (
    <div className="rounded-card border-[1.5px] border-dashed border-line px-6 py-10 text-center">
      <p className="font-display text-xl font-extrabold text-ink">{heading}</p>
      <p className="mt-2 text-sm text-muted">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
