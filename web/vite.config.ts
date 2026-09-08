import reactScan from "@react-scan/vite-plugin-react-scan";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";

export default defineConfig({
  plugins: [
    TanStackRouterVite({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    reactScan({
      enable: process.env.NODE_ENV === "development",
    }),
  ],
  server: {
    host: true, // expose on 0.0.0.0 for Tailscale access
    proxy: {
      // Forward backend requests to Hono during development.
      "/api": "http://localhost:3000",
    },
  },
});
