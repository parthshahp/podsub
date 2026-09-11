import type { ErrorComponentProps } from "@tanstack/react-router";
import type { ReactNode } from "react";

type Props = {
  className: string;
  children: ReactNode;
};

/**
 * The page landmark. `#main-content` is the skip link's target in the root
 * layout, and `tabIndex={-1}` lets that jump move focus without adding a tab
 * stop. Callers own the layout classes — the shell is only the landmark.
 */
export default function PageShell({ className, children }: Props) {
  return (
    <main id="main-content" tabIndex={-1} className={className}>
      {children}
    </main>
  );
}

/**
 * Paired `pendingComponent`/`errorComponent` for a loader-backed route, so each
 * route only names the thing it loads. A pathless layout route can't do this:
 * it replaces the route's `component`, while `pendingComponent`/`errorComponent`
 * stay per-route options and would have to be repeated anyway.
 */
export function pageLoadState(noun: string, className = "p-6") {
  return {
    pendingComponent: () => (
      <PageShell className={className}>
        <p className="text-sm text-base-content/60">Loading {noun}…</p>
      </PageShell>
    ),
    errorComponent: ({ error }: ErrorComponentProps) => (
      <PageShell className={className}>
        <p className="text-sm text-error">
          Failed to load {noun}: {error.message}
        </p>
      </PageShell>
    ),
  };
}
