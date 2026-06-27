import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { tanstackRouter } from "@tanstack/router-plugin/vite";

// Plain Vite SPA build. Outputs dist/ with a real index.html that the
// Fastify backend serves as static. All backend logic (syslog UDP, SQLite,
// UniFi poller, /api/*) lives in server/ — see server/index.ts.
export default defineConfig({
  plugins: [
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
      routesDirectory: "src/routes",
      generatedRouteTree: "src/routeTree.gen.ts",
    }),
    react(),
    tailwindcss(),
    tsconfigPaths(),
  ],
  server: {
    host: true,
    port: 8080,
    proxy: {
      // Forward API + WS to the Fastify dev server.
      "/api": { target: "http://localhost:8095", changeOrigin: true, ws: true },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
