// Small presentational building blocks shared by the sections.

import type { ButtonHTMLAttributes, ReactNode } from "react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function Card({ title, right, children, className, bodyClass }: {
  title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; bodyClass?: string;
}) {
  return (
    <section className={cx("flex min-w-0 flex-col rounded-xl border border-ink-700 bg-ink-850", className)}>
      {title && (
        <header className="flex items-center gap-2 border-b border-ink-700 px-4 py-2.5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</h2>
          {right && <div className="ml-auto flex items-center gap-2">{right}</div>}
        </header>
      )}
      <div className={cx("min-h-0 flex-1 p-4", bodyClass)}>{children}</div>
    </section>
  );
}

type Variant = "default" | "primary" | "danger" | "ghost" | "active";
const VARIANTS: Record<Variant, string> = {
  default: "border-ink-600 bg-ink-800 hover:border-accent",
  primary: "border-accent bg-accent text-white hover:bg-blue-500",
  danger: "border-red-900 bg-red-950/70 text-red-200 hover:border-red-500",
  ghost: "border-transparent bg-transparent text-slate-400 hover:text-slate-100 hover:bg-ink-800",
  active: "border-accent bg-blue-950 text-blue-100",
};

export function Button({ variant = "default", size = "md", className, ...p }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg" }) {
  return (
    <button
      {...p}
      className={cx(
        "inline-flex select-none items-center justify-center gap-1.5 rounded-lg border font-medium transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        size === "sm" ? "px-2.5 py-1 text-xs" : size === "lg" ? "px-4 py-2.5 text-sm" : "px-3 py-1.5 text-sm",
        VARIANTS[variant], className,
      )}
    />
  );
}

export function Stat({ label, value, unit, hint, className }: {
  label: string; value: ReactNode; unit?: string; hint?: string; className?: string;
}) {
  return (
    <div className={cx("min-w-0 rounded-lg bg-ink-800 px-3 py-2", className)} title={hint}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-0.5 truncate font-mono text-lg font-semibold tabular">
        {value}
        {unit && <span className="ml-1 text-xs font-medium text-slate-400">{unit}</span>}
      </div>
    </div>
  );
}

export type Tone = "ok" | "warn" | "bad" | "busy" | "off" | "info";

export function Dot({ tone }: { tone: Tone }) {
  return (
    <span
      className={cx(
        "inline-block size-2 shrink-0 rounded-full",
        tone === "ok" && "bg-emerald-400 shadow-[0_0_6px] shadow-emerald-400",
        tone === "warn" && "bg-amber-400",
        tone === "bad" && "bg-rose-500 shadow-[0_0_6px] shadow-rose-500",
        tone === "busy" && "animate-blink bg-amber-400",
        tone === "info" && "bg-sky-400",
        tone === "off" && "bg-slate-500",
      )}
    />
  );
}

const BADGE: Record<string, string> = {
  navigating: "bg-blue-950 text-blue-200", sending: "bg-blue-950 text-blue-200",
  succeeded: "bg-emerald-950 text-emerald-200",
  failed: "bg-rose-950 text-rose-200", rejected: "bg-rose-950 text-rose-200",
  canceled: "bg-amber-950 text-amber-200", canceling: "bg-amber-950 text-amber-200",
};

export function Badge({ children, state }: { children: ReactNode; state?: string }) {
  return (
    <span className={cx("rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide",
      (state && BADGE[state]) || "bg-ink-700 text-slate-300")}>
      {children}
    </span>
  );
}

export function fmt(v: number | null | undefined, d = 2) {
  return v === null || v === undefined || Number.isNaN(v) ? "–" : Number(v).toFixed(d);
}

export const deg = (r: number) => (r * 180) / Math.PI;

export function Empty({ children }: { children: ReactNode }) {
  return <div className="grid place-items-center rounded-lg border border-dashed border-ink-600 p-6 text-center text-sm text-slate-400">{children}</div>;
}
