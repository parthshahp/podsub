import { wasPointerInput } from "./motionInput";

type LocationChange = {
  fromLocation?: { pathname: string };
  toLocation: { pathname: string };
};

type Screen = { kind: "library" | "episodes" | "podcast" | "player"; id?: string };

function screen(pathname: string): Screen | undefined {
  const parts = pathname.split("/").filter(Boolean);
  if (!parts.length) return { kind: "library" };
  if (pathname === "/episodes") return { kind: "episodes" };
  if (parts.length !== 2) return;
  try {
    return {
      kind: parts[0] === "player" ? "player" : "podcast",
      id: decodeURIComponent(parts[1]!),
    };
  } catch {
    return;
  }
}

/** Peer tabs, search updates and switching episodes never acquire route motion. */
export function screenTransitionPlan(from: string, to: string) {
  const a = screen(from);
  const b = screen(to);
  if (!a || !b || from === to) return;
  if (a.kind === "library" && b.kind === "podcast")
    return { direction: "forward", podcastId: b.id };
  if (a.kind === "podcast" && b.kind === "library") return { direction: "back", podcastId: a.id };
  if (a.kind === "podcast" && b.kind === "player")
    return { direction: "forward", podcastId: a.id, episodeId: b.id };
  if (a.kind === "player" && b.kind === "podcast")
    return { direction: "back", podcastId: b.id, episodeId: a.id };
  if (a.kind === "episodes" && b.kind === "player")
    return { direction: "forward", artworkEpisodeId: b.id, episodeId: b.id };
  if (a.kind === "player" && b.kind === "episodes")
    return { direction: "back", artworkEpisodeId: a.id, episodeId: a.id };
}

/**
 * The router invokes `types` only when committing loaded content. Remember the
 * initiating input, so a later tap during a slow keyboard navigation can't
 * opt it into motion. Only two selected elements get names, rather than
 * capturing every cover in a long library or a repeated show in episode rows.
 */
export function createScreenTransitions() {
  let navigation: { from: string; to: string; pointer: boolean } | undefined;
  let names: HTMLStyleElement | undefined;
  let browserOwnsNavigation = false;

  function onPopState(event: PopStateEvent) {
    browserOwnsNavigation =
      (event as PopStateEvent & { hasUAVisualTransition?: boolean }).hasUAVisualTransition === true;
  }

  function beforeNavigate({ fromLocation, toLocation }: LocationChange) {
    // Finish an older app transition when another navigation interrupts it.
    (
      document as Document & { activeViewTransition?: ViewTransition }
    ).activeViewTransition?.skipTransition();
    names?.remove();
    names = undefined;
    navigation = fromLocation
      ? {
          from: fromLocation.pathname,
          to: toLocation.pathname,
          pointer: wasPointerInput() && !browserOwnsNavigation,
        }
      : undefined;
    browserOwnsNavigation = false;
  }

  function types({ fromLocation, toLocation }: LocationChange): string[] | false {
    if (
      !navigation?.pointer ||
      !wasPointerInput() ||
      navigation.from !== fromLocation?.pathname ||
      navigation.to !== toLocation.pathname ||
      document.querySelector("[data-screen-pending]") ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return false;
    const plan = screenTransitionPlan(navigation.from, navigation.to);
    if (!plan) return false;

    const artwork = plan.podcastId
      ? `[data-podcast-artwork="${CSS.escape(plan.podcastId)}"]`
      : `[data-episode-artwork="${CSS.escape(plan.artworkEpisodeId!)}"]`;
    const title = plan.episodeId
      ? `[data-episode-title="${CSS.escape(plan.episodeId)}"]`
      : undefined;
    // Never fly an offscreen header across a long, scrolled episode list.
    const visible = (selector: string) =>
      Array.from(document.querySelectorAll(selector)).some((element) => {
        const rect = element.getBoundingClientRect();
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          rect.bottom > 0 &&
          rect.top < window.innerHeight &&
          rect.right > 0 &&
          rect.left < window.innerWidth
        );
      });
    names = document.createElement("style");
    names.dataset.screenTransitionNames = "";
    names.textContent =
      (visible(artwork) ? `${artwork} { view-transition-name: screen-artwork; }` : "") +
      (title && visible(title) ? `${title} { view-transition-name: screen-title; }` : "");
    document.head.append(names);
    return [`podsub-${plan.direction}`];
  }

  return { beforeNavigate, types, onPopState, dispose: () => names?.remove() };
}
