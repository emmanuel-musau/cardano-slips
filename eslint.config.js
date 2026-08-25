import js from "@eslint/js"
import prettier from "eslint-config-prettier/flat"
import tseslint from "typescript-eslint"

export default tseslint.config(
  {
    // Global ignores: flat config treats an object carrying only `ignores` this way.
    ignores: ["**/dist/**", "**/build/**", "**/coverage/**", "**/.turbo/**", "**/.tsbuildinfo/**", "**/node_modules/**"]
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ["**/*.{ts,tsx,js,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module"
    },
    rules: {
      // `_`-prefixed means deliberately unused.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_"
        }
      ],

      // Library code returns typed errors; user-facing messages go through the
      // spec error codes in `flow` and the slip page, not the console.
      "no-console": "error",

      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" }
      ],
      "object-shorthand": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-var": "error",
      "prefer-const": "error"
    }
  },

  // Must stay last: switches off every rule Prettier already decides.
  prettier
)
