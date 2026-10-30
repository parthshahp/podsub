import { Link, useRouterState } from "@tanstack/react-router";
import { GearIcon, ListIcon } from "./icons";

/** Browsing tabs stay near the thumb. The player keeps its own footer. */
export default function BottomNav() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const library = pathname !== "/episodes" && pathname !== "/settings";
  const items = [
    { to: "/" as const, label: "Library", active: library, icon: <LibraryIcon /> },
    {
      to: "/episodes" as const,
      label: "Episodes",
      active: pathname === "/episodes",
      icon: <ListIcon className="h-5 w-5" />,
    },
    {
      to: "/settings" as const,
      label: "Settings",
      active: pathname === "/settings",
      icon: <GearIcon className="h-5 w-5" />,
    },
  ];
  return (
    <nav
      aria-label="Main navigation"
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-3 border-t border-base-300 bg-base-100 pb-[env(safe-area-inset-bottom,0px)] pl-[env(safe-area-inset-left,0px)] pr-[env(safe-area-inset-right,0px)] md:hidden"
    >
      {items.map(({ to, label, active, icon }) => (
        <Link
          key={to}
          to={to}
          activeOptions={{ exact: true }}
          aria-current={active ? "page" : undefined}
          className={`flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-medium ${active ? "text-primary" : "text-base-content/60"}`}
        >
          {icon}
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  );
}

function LibraryIcon() {
  return (
    <svg
      className="h-5 w-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 4v16M9 4v16M14 4v16M18 4l3 16M3 20h19" />
    </svg>
  );
}
