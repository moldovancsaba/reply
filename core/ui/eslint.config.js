import { createGdsConfig } from "@sovereignsquad/gds-eslint-config";
import tseslint from "typescript-eslint";

export default [
  { ignores: ["dist/**", "node_modules/**", "playwright-report/**", "test-results/**", "src/api/types.gen.ts"] },
  ...tseslint.configs.recommended,
  ...createGdsConfig({}),
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      // GDS is the only UI source: Mantine is reached through GDS exports, never imported directly.
      "no-restricted-imports": ["error", { patterns: [{ group: ["@mantine/*"], message: "Import from @sovereignsquad/gds instead of Mantine." }] }],
    },
  },
];
