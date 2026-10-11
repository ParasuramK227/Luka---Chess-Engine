import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

export function clsx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

type BtnVariant = "primary" | "ghost" | "danger" | "subtle" | "outline";

const btnStyles: Record<BtnVariant, string> = {
  primary: "bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm",
  ghost: "bg-transparent hover:bg-stone-800 text-stone-200",
  danger: "bg-red-700 hover:bg-red-600 text-white",
  subtle: "bg-stone-800 hover:bg-stone-700 text-stone-200",
  outline: "border border-stone-700 hover:border-stone-500 text-stone-200 bg-transparent",
};

export function Button({
  variant = "primary",
  small,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; small?: boolean }) {
  return (
    <button
      {...rest}
      className={clsx(
        "inline-flex items-center justify-center gap-1.5 rounded font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
        small ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm",
        btnStyles[variant],
        className,
      )}
    />
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-400">{label}</span>
      {children}
      {hint ? <span className="mt-0.5 block text-xs text-stone-500">{hint}</span> : null}
    </label>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...rest}
      className={clsx(
        "w-full rounded border border-stone-700 bg-stone-900 px-2.5 py-1.5 text-sm text-stone-100 outline-none focus:border-emerald-500",
        className,
      )}
    />
  );
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...rest}
      className={clsx(
        "w-full rounded border border-stone-700 bg-stone-900 px-2 py-1.5 text-sm text-stone-100 outline-none focus:border-emerald-500",
        className,
      )}
    >
      {children}
    </select>
  );
}

export function NumberInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="number"
      {...rest}
      className={clsx(
        "rounded border border-stone-700 bg-stone-900 px-2 py-1.5 text-sm text-stone-100 outline-none focus:border-emerald-500",
        className,
      )}
    />
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2 text-sm text-stone-300"
    >
      <span
        className={clsx(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
          checked ? "bg-emerald-600" : "bg-stone-700",
        )}
      >
        <span
          className={clsx(
            "inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform",
            checked ? "translate-x-[18px]" : "translate-x-[3px]",
          )}
        />
      </span>
      {label}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={clsx(
        "inline-block h-4 w-4 animate-spin rounded-full border-2 border-stone-500 border-t-emerald-400",
        className,
      )}
    />
  );
}

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={clsx("h-1.5 w-full overflow-hidden rounded-full bg-stone-800", className)}>
      <div
        className="h-full rounded-full bg-emerald-500 transition-all duration-300"
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

export function Card({ title, right, children, className }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={clsx("rounded-lg border border-stone-800 bg-stone-900/60", className)}>
      {title ? (
        <header className="flex items-center justify-between border-b border-stone-800 px-3 py-2">
          <h3 className="text-sm font-semibold text-stone-200">{title}</h3>
          {right}
        </header>
      ) : null}
      <div className="p-3">{children}</div>
    </section>
  );
}

export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={clsx("inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white", className)}>
      {children}
    </span>
  );
}

export function EmptyState({ title, body }: { title: string; body?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-stone-800 px-6 py-10 text-center">
      <p className="text-sm font-medium text-stone-300">{title}</p>
      {body ? <div className="mt-1 text-xs text-stone-500">{body}</div> : null}
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-3 text-lg font-semibold text-stone-100">{children}</h2>;
}