import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const enableE2EAuthMock = process.env.VITE_E2E_AUTH_MOCK === "true";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: enableE2EAuthMock
      ? {
          "@asgardeo/react": fileURLToPath(new URL("../e2e/support/asgardeo-react-mock.js", import.meta.url))
        }
      : {}
  }
});
