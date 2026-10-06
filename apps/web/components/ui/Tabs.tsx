"use client";

import { AnimatePresence, motion } from "framer-motion";

interface TabsProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
}

export function Tabs<T extends string>({ value, onChange, options }: TabsProps<T>) {
  return (
    <div className="flex gap-1" role="tablist">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={`rounded-pill px-4 py-1.5 text-sm font-bold transition-colors duration-200 ${
              active ? "border border-lime/20 bg-lime/10 text-lime" : "text-muted hover:text-ink"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

interface TabPanelProps {
  tabKey: string;
  children: React.ReactNode;
}

// Wraps tab content so switching tabs replays the spec's content-swap
// motion (opacity, y 12 -> 0 -> -12, .25s). Caller re-mounts this with a
// new `tabKey` per active tab so AnimatePresence sees it as an exit/enter.
export function TabPanel({ tabKey, children }: TabPanelProps) {
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={tabKey}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -12 }}
        transition={{ duration: 0.25 }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
