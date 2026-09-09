import { Link } from "@tanstack/react-router";
import { GearIcon, ListIcon } from "./icons";

export default function NavBar() {
  return (
    <header className="navbar border-b border-base-300 bg-base-100 px-6">
      <Link to="/" search={{ q: "" }} className="link link-hover text-lg font-semibold">
        PodSub
      </Link>
      <nav className="ml-auto flex items-center gap-2">
        <Link
          to="/episodes"
          className="btn btn-ghost btn-circle btn-sm"
          aria-label="All episodes"
          title="All episodes"
        >
          <ListIcon className="h-5 w-5" />
        </Link>
        <Link
          to="/settings"
          className="btn btn-ghost btn-circle btn-sm"
          aria-label="Settings"
          title="Settings"
        >
          <GearIcon className="h-5 w-5" />
        </Link>
      </nav>
    </header>
  );
}
