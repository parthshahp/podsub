import { Link, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { api } from "../api";
import { GearIcon, ListIcon, SearchIcon, SyncIcon } from "./icons";

function SyncButton() {
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<{ message: string; retry: boolean } | null>(null);
  const busyRef = useRef(false);
  const router = useRouter();

  useEffect(() => {
    if (!notice || notice.retry) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  async function sync() {
    // Client-side guard for instant UX; the endpoint's 409 is the real
    // dedup (covers a second tab or overlap with the scheduled run).
    if (busyRef.current) return;
    busyRef.current = true;
    setSyncing(true);
    setNotice(null);
    try {
      const res = await api.api.podcasts.refresh.$post();
      if (res.status === 409) {
        setNotice({ message: "A feed sync is already running. Try again shortly.", retry: true });
        return;
      }
      if (!res.ok) throw new Error(`Sync failed (${res.status})`);
      const summary = await res.json();
      await router.invalidate();
      if ("failed" in summary && summary.failed > 0) {
        setNotice({
          message: `${summary.failed} of ${summary.total} feeds could not sync. Try again.`,
          retry: true,
        });
      } else {
        setNotice({ message: "Feeds synced.", retry: false });
      }
    } catch (err) {
      console.error("Feed sync failed:", err);
      setNotice({
        message: "Could not sync feeds. Check your connection and try again.",
        retry: true,
      });
    } finally {
      busyRef.current = false;
      setSyncing(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => void sync()}
        disabled={syncing}
        aria-label={syncing ? "Syncing feeds" : "Sync feeds"}
        title="Sync feeds"
        className="btn btn-ghost btn-circle btn-sm"
      >
        <span className={syncing ? "animate-spin motion-reduce:animate-none" : undefined}>
          <SyncIcon className="h-5 w-5" />
        </span>
      </button>
      <div role="status" aria-atomic="true">
        {notice && (
          <div className="absolute inset-x-4 top-full z-50 mt-2 flex flex-wrap items-center gap-3 rounded-lg border border-base-300 bg-base-100 p-3 text-sm shadow-lg sm:right-6 sm:left-auto sm:max-w-sm">
            <p className="min-w-0 flex-1">{notice.message}</p>
            {notice.retry && (
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void sync()}>
                Retry
              </button>
            )}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNotice(null)}>
              Dismiss
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function NavBar({ showMobileLinks = true }: { showMobileLinks?: boolean }) {
  return (
    <header
      id="app-header"
      className="navbar relative z-40 border-b border-base-300 bg-base-100 px-6"
    >
      <Link to="/" className="link link-hover text-lg font-semibold">
        PodSub
      </Link>
      <nav className="ml-auto flex items-center gap-2">
        <SyncButton />
        <span className={showMobileLinks ? "contents" : "hidden md:contents"}>
          <Link
            to="/search"
            search={{ q: "", podcastId: "", page: 0 }}
            className="btn btn-ghost btn-circle btn-sm"
            aria-label="Search transcripts"
            title="Search transcripts"
          >
            <SearchIcon className="h-5 w-5" />
          </Link>
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
        </span>
      </nav>
    </header>
  );
}
