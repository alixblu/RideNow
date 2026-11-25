import type { ReactNode } from "react";

export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main
      data-touch
      className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col justify-center gap-8 px-6 py-10"
    >
      <div className="flex flex-col items-center gap-3 text-center">
        <span
          aria-hidden="true"
          className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent text-3xl font-extrabold text-accent-fg"
        >
          R
        </span>
        <h1 className="text-3xl font-extrabold text-content">RideNow</h1>
        <p className="text-content-muted">{title}</p>
      </div>
      {children}
    </main>
  );
}
