import obsidian from "eslint-plugin-obsidianmd";

export default [
  { ignores: ["main.js"] },
  ...obsidian.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } }
  }
];
