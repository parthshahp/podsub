import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after } from "node:test";

const directory = await mkdtemp(
  fileURLToPath(new URL("../../node_modules/.podsub-tests-", import.meta.url)),
);
after(() => rm(directory, { recursive: true, force: true }));
const outfile = `${directory}/components.mjs`;
await build({
  stdin: {
    contents: `
      export { useEpisodeList } from './hooks/useEpisodeList';
      export { usePlayer } from './hooks/usePlayer';
      export { default as EpisodeList } from './components/EpisodeList';
      export { PlayerBar } from './components/player/PlayerBar';
      export * from './lib/playbackSettings';
    `,
    resolveDir: fileURLToPath(new URL("../../src/", import.meta.url)),
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  jsx: "automatic",
  packages: "external",
  outfile,
  plugins: [
    {
      name: "test-boundaries",
      setup(builder) {
        builder.onResolve({ filter: /^react$/ }, () => ({ path: "react", external: true }));
        builder.onResolve(
          { filter: /^(\.\.\/api|\.\.\/lib\/transcribe|@tanstack\/react-router)$/ },
          ({ path }) => ({ path, namespace: "test" }),
        );
        builder.onLoad({ filter: /.*/, namespace: "test" }, ({ path }) => ({
          contents:
            path === "../api"
              ? "export const api = { get api() { return globalThis.podsubTest.api.api; } };"
              : path === "../lib/transcribe"
                ? "export const requestTranscription = (...args) => globalThis.podsubTest.transcribe(...args);"
                : "import {createElement} from 'react'; export const Link = ({children}) => createElement('a', null, children);",
          loader: "js",
        }));
      },
    },
  ],
});
export const components = await import(pathToFileURL(outfile).href);
