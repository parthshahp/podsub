// Generates `src/routeTree.gen.ts` without starting Vite in dev or watch mode.
//
// The route tree is a generated artifact and is gitignored (.gitignore), so on a
// fresh clone it does not exist and `tsc --noEmit` fails to resolve
// `./routeTree.gen` (imported by src/router.tsx). `pnpm typecheck` therefore
// runs this script first via the `pretypecheck` script in package.json.
//
// The TanStack Router Vite plugin generates the tree inside its `configResolved`
// hook, so calling that hook directly is enough — no dev server, no watcher.
//
// Keep the options in sync with `TanStackRouterVite({ ... })` in vite.config.ts.
import { fileURLToPath } from "node:url";

import { tanstackRouterGenerator } from "@tanstack/router-plugin/vite";

const root = fileURLToPath(new URL("..", import.meta.url));

const plugin = tanstackRouterGenerator({
  target: "react",
  autoCodeSplitting: true,
});

await plugin.configResolved({ root });
