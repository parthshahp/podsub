import { Outlet, createRootRoute } from "@tanstack/react-router";
import NavBar from "../components/NavBar";

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
  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-content"
      >
        Skip to main content
      </a>
      <NavBar />
      <Outlet />
    </>
  );
}
