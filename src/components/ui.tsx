import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost" }) {
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-50 disabled:pointer-events-none";
  const variants: Record<string, string> = {
    primary: "bg-emerald-600 text-white hover:bg-emerald-700",
    secondary: "bg-zinc-100 text-zinc-900 hover:bg-zinc-200",
    danger: "bg-red-600 text-white hover:bg-red-700",
    ghost: "bg-transparent text-zinc-700 hover:bg-zinc-100",
  };
  return <button className={`${base} ${variants[variant]} ${className}`} {...props} />;
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 ${props.className ?? ""}`}
    />
  );
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 ${props.className ?? ""}`}
    />
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-zinc-200 bg-white p-5 shadow-sm ${className}`}>{children}</div>;
}

export function Label({ children }: { children: ReactNode }) {
  return <label className="mb-1 block text-xs font-medium text-zinc-600">{children}</label>;
}

export function Badge({ children, color = "zinc" }: { children: ReactNode; color?: "zinc" | "green" | "red" | "amber" }) {
  const colors: Record<string, string> = {
    zinc: "bg-zinc-100 text-zinc-700",
    green: "bg-green-100 text-green-700",
    red: "bg-red-100 text-red-700",
    amber: "bg-amber-100 text-amber-700",
  };
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${colors[color]}`}>{children}</span>;
}

export function Spinner() {
  return <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-300 border-t-emerald-600" />;
}
