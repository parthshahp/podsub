import { createRouter } from "@tanstack/react-router";

import { routeTree } from "./routeTree.gen";
import { createScreenTransitions } from "./lib/screenTransitions";

const screenTransitions = createScreenTransitions();

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  defaultPreloadStaleTime: 0,
  scrollRestoration: true,
  // Older browsers keep instant navigation. Without typed-transition support,
  // the router bypasses `types`, which would accidentally animate peer tabs.
  defaultViewTransition:
    typeof CSS !== "undefined" &&
    CSS.supports("selector(:active-view-transition-type(podsub-forward))")
      ? { types: screenTransitions.types }
      : false,
});

const unsubscribeScreenTransitions = router.subscribe(
  "onBeforeNavigate",
  screenTransitions.beforeNavigate,
);
// Capture runs before the history listener, including Safari's native back swipe.
window.addEventListener("popstate", screenTransitions.onPopState, { capture: true });
import.meta.hot?.dispose(() => {
  unsubscribeScreenTransitions();
  window.removeEventListener("popstate", screenTransitions.onPopState, { capture: true });
  screenTransitions.dispose();
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
