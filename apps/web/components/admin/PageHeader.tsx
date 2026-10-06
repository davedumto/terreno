interface PageHeaderProps {
  eyebrow: string;
  title: React.ReactNode;
  lead?: string;
  actions?: React.ReactNode;
}

export function PageHeader({ eyebrow, title, lead, actions }: PageHeaderProps) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-6">
      <div>
        <p className="font-mono text-[.75rem] font-bold uppercase tracking-[.22em] text-muted2">
          {eyebrow}
        </p>
        <h1 className="mt-1 font-display text-[clamp(1.75rem,1.4rem+1.2vw,2.5rem)] font-extrabold tracking-[-0.01em] text-ink">
          {title}
        </h1>
        {lead && <p className="mt-2 max-w-[56ch] text-[.9375rem] leading-[1.6] text-muted">{lead}</p>}
      </div>
      {actions && <div className="flex gap-3">{actions}</div>}
    </header>
  );
}
