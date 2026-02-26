import js from "@eslint/js";

export default [
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "commonjs",
            globals: {
                // Node.js globals
                require: "readonly",
                module: "readonly",
                exports: "readonly",
                __dirname: "readonly",
                __filename: "readonly",
                process: "readonly",
                console: "readonly",
                Buffer: "readonly",
                setTimeout: "readonly",
                setInterval: "readonly",
                clearTimeout: "readonly",
                clearInterval: "readonly",
                URL: "readonly",
                URLSearchParams: "readonly",
                fetch: "readonly",
                AbortController: "readonly",
            },
        },
        rules: {
            "no-unused-vars": "off",
            "no-undef": "error",
            "no-constant-condition": "warn",
            "no-empty": ["warn", { allowEmptyCatch: true }],
            "prefer-const": "warn",
        },
    },
    {
        // Browser-only files
        files: ["js/**/*.js", "chrome-extension/**/*.js"],
        languageOptions: {
            sourceType: "module",
            globals: {
                window: "readonly",
                document: "readonly",
                fetch: "readonly",
                HTMLElement: "readonly",
                Element: "readonly",
                Event: "readonly",
                event: "readonly",
                FormData: "readonly",
                FileReader: "readonly",
                localStorage: "readonly",
                navigator: "readonly",
                MediaRecorder: "readonly",
                SpeechRecognition: "readonly",
                webkitSpeechRecognition: "readonly",
                IntersectionObserver: "readonly",
                AbortController: "readonly",
                chrome: "readonly",
                alert: "readonly",
                confirm: "readonly",
            },
        },
    },
    {
        // Browser & Script files
        files: ["linkedin-scraper-snippet.js", "chrome-extension/**/*.js"],
        languageOptions: {
            globals: {
                document: "readonly",
                window: "readonly",
                chrome: "readonly",
                fetch: "readonly",
                IntersectionObserver: "readonly",
            }
        }
    },
    {
        ignores: [
            "node_modules/**",
            "test-hybrid-db/**",
            "test-hybrid-db-final/**",
            "tmp-db/**",
            "data/**",
            "*.completed.js",
            "repro-*.js",
            "test-*.js",
            "eslint.config.mjs",
        ],
    },
];
