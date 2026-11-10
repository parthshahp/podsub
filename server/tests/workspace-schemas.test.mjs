import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = fileURLToPath(new URL("../../", import.meta.url));
const schemaDir = path.join(root, "packages/schemas");
const consumerSource = `
import {
  LineExplanationSchema, ExplainLineInputSchema,
  type ExplanationModel, type LineExplanation, type PodcastList,
} from "@podsub/schemas";

const podcast: PodcastList = {
  id: "demo", title: "Demo", imageUrl: null,
  createdAt: "2026-11-09T00:00:00.000Z", latestEpisodeAt: null,
};
const model: ExplanationModel = "deepseek/deepseek-v4.1-flash";
const result: LineExplanation = LineExplanationSchema.parse({
  translation: "Hello", explanation: "A greeting", phrases: [],
});
ExplainLineInputSchema.parse({ lineIndex: 0, text: "你好", model });
void podcast; void result;
`;

// Build isolated workspaces, not the real dist directory: the other server tests
// import the package concurrently, and deployment regressions must not touch it.
for (const [consumer, command] of [
  ["server", "typecheck"],
  ["server", "build"],
  ["web", "typecheck"],
]) {
  for (const state of ["missing", "stale"]) {
    test(`${consumer} ${command} rebuilds ${state} schema output before compiling`, async () => {
      const fixture = await mkdtemp(path.join(os.tmpdir(), "podsub-schema-build-"));
      try {
        const schemas = path.join(fixture, "packages/schemas");
        const app = path.join(fixture, consumer);
        await mkdir(schemas, { recursive: true });
        await mkdir(path.join(app, "src"), { recursive: true });
        await mkdir(path.join(app, "node_modules/@podsub"), { recursive: true });
        await writeFile(
          path.join(fixture, "package.json"),
          '{"private":true,"name":"schema-build-fixture"}',
        );
        await writeFile(
          path.join(fixture, "pnpm-workspace.yaml"),
          `packages:\n  - packages/*\n  - ${consumer}\nverifyDepsBeforeRun: false\n`,
        );
        for (const file of ["package.json", "tsconfig.json", "src"]) {
          await cp(path.join(schemaDir, file), path.join(schemas, file), { recursive: true });
        }
        await mkdir(path.join(schemas, "node_modules"));
        for (const dependency of ["typescript", "zod", ".bin"]) {
          await symlink(
            await realpath(path.join(schemaDir, "node_modules", dependency)),
            path.join(schemas, "node_modules", dependency),
            "dir",
          );
        }
        await symlink(schemas, path.join(app, "node_modules/@podsub/schemas"), "dir");
        await symlink(
          path.join(root, consumer, "node_modules/.bin"),
          path.join(app, "node_modules/.bin"),
          "dir",
        );
        await symlink(
          path.join(root, consumer, "node_modules/typescript"),
          path.join(app, "node_modules/typescript"),
          "dir",
        );
        const manifest = JSON.parse(
          await readFile(path.join(root, consumer, "package.json"), "utf8"),
        );
        await writeFile(
          path.join(app, "package.json"),
          JSON.stringify({
            name: manifest.name,
            type: "module",
            scripts: { [command]: manifest.scripts[command] },
            dependencies: { "@podsub/schemas": "workspace:*" },
          }),
        );
        await writeFile(
          path.join(app, "tsconfig.json"),
          JSON.stringify({
            compilerOptions: {
              target: "ESNext",
              module: "ESNext",
              moduleResolution: "bundler",
              strict: true,
              skipLibCheck: true,
              types: [],
              rootDir: "./src",
              outDir: "./dist",
            },
            include: ["src"],
          }),
        );
        await writeFile(path.join(app, "src/index.ts"), consumerSource);
        if (state === "stale") {
          await mkdir(path.join(schemas, "dist"));
          await writeFile(
            path.join(schemas, "dist/index.d.ts"),
            "export type PodcastList = { id: string; title: string; imageUrl: string | null };\n",
          );
          await writeFile(path.join(schemas, "dist/index.js"), "export {};\n");
        }

        // Demonstrate the original deployment failure before running the fix.
        const direct = spawnSync("pnpm", ["exec", "tsc", "--noEmit"], {
          cwd: app,
          encoding: "utf8",
        });
        assert.notEqual(
          direct.status,
          0,
          "direct tsc should reject missing/stale schema declarations",
        );
        assert.match(direct.stdout + direct.stderr, /@podsub\/schemas|createdAt/);
        if (state === "stale") {
          assert.match(direct.stdout + direct.stderr, /createdAt/);
          assert.match(direct.stdout + direct.stderr, /LineExplanationSchema/);
        }

        // Execute the real consumer script, without a manual schema build.
        execFileSync("pnpm", [command], {
          cwd: app,
          encoding: "utf8",
          timeout: 60_000,
          stdio: "pipe",
        });
        const declarations = await readFile(path.join(schemas, "dist/index.d.ts"), "utf8");
        assert.match(declarations, /LineExplanationSchema/);
        assert.match(declarations, /ExplainLineInputSchema/);
        assert.match(declarations, /createdAt/);
        const runtime = await readFile(path.join(schemas, "dist/index.js"), "utf8");
        assert.match(runtime, /export const LineExplanationSchema/);
      } finally {
        await rm(fixture, { recursive: true, force: true });
      }
    });
  }
}
