import { Outlet, createRootRoute, useRouterState } from "@tanstack/react-router";
import NavBar from "../components/NavBar";
import BottomNav from "../components/BottomNav";

export const Route = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFound,
});

function NotFound() {
  return (
    <div className="p-6">
      <p className="text-sm text-base-content/60">Page not found.</p>
    </div>
  );
}

function RootLayout() {
  const isPlayer = useRouterState({
    select: (state) => state.location.pathname.startsWith("/player/"),
  });
  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-content"
      >
        Skip to main content
      </a>
      <NavBar showMobileLinks={isPlayer} />
      <div className={isPlayer ? undefined : "pb-12 md:pb-0"}>
        <Outlet />
      </div>
      {!isPlayer && <BottomNav />}
    </>
  );
}
