import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");
const write = (file, value) => fs.writeFileSync(file, value, "utf8");
const required = (source, from, to, label) => {
  if (!source.includes(from)) throw new Error(`Pattern not found: ${label}`);
  return source.replace(from, to);
};

let source = read("src/main.ts");
source = required(
  source,
  'import { shell as rawElectronShell } from "electron";',
  'import { shell as electronShell } from "electron";',
  "direct typed Electron import",
);
source = required(
  source,
  'interface ElectronShell {\n  showItemInFolder(fullPath: string): void;\n}\n\nconst electronShell = rawElectronShell as unknown as ElectronShell;\n\n',
  "",
  "remove unnecessary Electron assertion",
);
write("src/main.ts", source);

write("src/node-runtime.d.ts", `declare module "node:fs" {
  export interface Dirent {
    name: string;
    isDirectory(): boolean;
    isFile(): boolean;
    isSymbolicLink(): boolean;
  }

  export interface Stats {
    size: number;
    mtimeMs: number;
    isDirectory(): boolean;
    isFile(): boolean;
  }
}

declare module "node:fs/promises" {
  export function mkdir(path: string, options: { recursive: true }): Promise<string | undefined>;
  export function readFile(path: string, encoding: "utf8"): Promise<string>;
  export function readdir(path: string, options: { withFileTypes: true }): Promise<import("node:fs").Dirent[]>;
  export function realpath(path: string): Promise<string>;
  export function rm(path: string, options: { force: true }): Promise<void>;
  export function stat(path: string): Promise<import("node:fs").Stats>;
  export function writeFile(path: string, data: string, encoding: "utf8"): Promise<void>;
}

declare module "node:path" {
  export function basename(path: string): string;
  export function dirname(path: string): string;
  export function extname(path: string): string;
  export function join(...paths: string[]): string;
}
`);

const manifest = JSON.parse(read("manifest.json"));
manifest.version = "1.0.5";
write("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);

const versions = JSON.parse(read("versions.json"));
versions["1.0.5"] = manifest.minAppVersion;
write("versions.json", `${JSON.stringify(versions, null, 2)}\n`);

const pkg = JSON.parse(read("package.json"));
pkg.version = "1.0.5";
write("package.json", `${JSON.stringify(pkg, null, 2)}\n`);

const lock = JSON.parse(read("package-lock.json"));
lock.version = "1.0.5";
if (lock.packages?.[""]) lock.packages[""].version = "1.0.5";
write("package-lock.json", `${JSON.stringify(lock, null, 2)}\n`);

let build = read("esbuild.config.mjs");
build = build.replace("Vault Storage Map v1.0.4", "Vault Storage Map v1.0.5");
write("esbuild.config.mjs", build);

write("RELEASE_NOTES_1.0.5.md", `# Vault Storage Map 1.0.5\n\nCommunity review typing cleanup:\n\n- Remove an unnecessary Electron type assertion.\n- Add precise local declarations for the small subset of Node.js filesystem and path APIs used by the plugin.\n- Preserve the existing runtime behavior and Obsidian minimum version.\n\nThe direct filesystem and clipboard notices remain intentional features of the desktop storage analyzer.\n`);

for (const file of [
  "tools/apply-community-typing-1.0.5.mjs",
  ".github/workflows/publish-1.0.5.yml",
]) fs.rmSync(file, { force: true });
