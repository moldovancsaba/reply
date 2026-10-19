import js from "@eslint/js";
import globals from "globals";

export default [
    { ignores: ["node_modules/**", "ui/**"] }, // the UI is a separate package with its own lint (GDS rules)
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: "module",
            globals: { ...globals.node },
        },
    },
];
