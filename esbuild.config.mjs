import esbuild from "esbuild";
import process from "node:process";
import { builtinModules } from "node:module";

const banner = `/* Vault Storage Map v1.0.5 | MIT */`;
const prod = process.argv[2] === "production";
const nodeBuiltins = [...new Set(builtinModules.flatMap((name) => [name, `node:${name}`]))];

const context = await esbuild.context({
  banner: { js: banner },
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", ...nodeBuiltins],
  format: "cjs",
  target: "es2022",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js"
});

if (prod) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
