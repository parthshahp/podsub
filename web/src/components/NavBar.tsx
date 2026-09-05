import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { GearIcon } from "./icons";

type Theme = "light" | "dark";

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  try {
    const saved = localStorage.getItem("theme");
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

export default function NavBar() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const isDark = theme === "dark";

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("theme", theme);
    } catch {
      // Storage unavailable (private mode) — theme still applies for the session.
    }
  }, [theme]);

  return (
    <header className="navbar border-b border-base-300 bg-base-100 px-6">
      <Link to="/" search={{ q: "" }} className="link link-hover text-lg font-semibold">
        PodSub
      </Link>
      <nav className="ml-auto flex items-center gap-2">
        {/* daisyUI swap: toggles the sun/moon icons with a rotate animation */}
        <label className="swap swap-rotate btn btn-ghost btn-circle btn-sm">
          <input
            type="checkbox"
            className="theme-controller"
            value="dark"
            checked={isDark}
            onChange={() => setTheme(isDark ? "light" : "dark")}
            aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
          />
          {/* sun icon (dark mode) */}
          <svg
            className="swap-on h-5 w-5"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" />
          </svg>
          {/* moon icon (light mode) */}
          <svg
            className="swap-off h-5 w-5"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 12 21.75a9.753 9.753 0 0 0 9.752-6.748Z" />
          </svg>
        </label>
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
