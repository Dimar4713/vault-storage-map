import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";

const banner = `/* Vault Storage Map v1.0.0 | MIT */`;
const prod = process.argv[2] === "production";
const context = await esbuild.context({
  banner: { js: banner },
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "node:fs", "node:fs/promises", "node:path", ...builtins],
  format: "cjs",
  target: "es2022",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  minify: prod, 
  outfile: "main.js"
});

if (prod) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
