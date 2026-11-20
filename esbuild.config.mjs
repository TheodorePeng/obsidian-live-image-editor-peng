import { readFile } from "node:fs/promises";
import { build } from "esbuild";

const markdownLicense = await readFile(new URL("./node_modules/@lezer/markdown/LICENSE", import.meta.url), "utf8");

await build({
  entryPoints: ["src/main.ts"],
  outfile: "main.js",
  bundle: true,
  format: "cjs",
  target: "es2021",
  external: ["obsidian", "@codemirror/*", "@lezer/common", "@lezer/highlight"],
  footer: { js: `/* @lezer/markdown\n${markdownLicense}*/` },
  logLevel: "info"
});
