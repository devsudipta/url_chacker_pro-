import js from "@eslint/js";
import ts from "typescript-eslint";
export default ts.config(
  { ignores: ["out/**", "dist/**", "node_modules/**", ".npm-cache/**"] },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
    },
  },
);
