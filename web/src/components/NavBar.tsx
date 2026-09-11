import { Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { api } from "../api";
import { GearIcon, ListIcon, SyncIcon } from "./icons";

function SyncButton() {
  const [syncing, setSyncing] = useState(false);
  const router = useRouter();

  async function sync() {
    // Client-side guard for instant UX; the endpoint's 409 is the real
    // dedup (covers a second tab or overlap with the scheduled run).
    if (syncing) return;
    setSyncing(true);
    try {
      const res = await api.api.podcasts.refresh.$post();
      if (res.status === 409) return;
      if (!res.ok) throw new Error(`Sync failed (${res.status})`);
      await router.invalidate();
    } catch (err) {
      console.error("Feed sync failed:", err);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void sync()}
      disabled={syncing}
      aria-label="Sync feeds"
      title="Sync feeds"
      className="btn btn-ghost btn-circle btn-sm"
    >
      <SyncIcon className={`h-5 w-5${syncing ? " animate-spin" : ""}`} />
    </button>
  );
}

export default function NavBar() {
  return (
    <header className="navbar border-b border-base-300 bg-base-100 px-6">
      <Link to="/" search={{ q: "" }} className="link link-hover text-lg font-semibold">
        PodSub
      </Link>
      <nav className="ml-auto flex items-center gap-2">
        <SyncButton />
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
