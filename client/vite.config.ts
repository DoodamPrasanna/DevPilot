import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "127.0.0.1",
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.tsx"],
    restoreMocks: true,
    clearMocks: true,
  },
});
