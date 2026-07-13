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
  'import { shell as electronShell } from "electron";\nimport type { Dirent } from "node:fs";\nimport * as fs from "node:fs/promises";\nimport * as path from "node:path";',
  'import { shell as rawElectronShell } from "electron";\nimport type { Dirent } from "node:fs";\nimport { mkdir, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";\nimport { basename, dirname, extname, join } from "node:path";',
  "typed Node imports",
);

source = required(
  source,
  'const MAX_CACHED_NODES = 50_000;\n',
  'const MAX_CACHED_NODES = 50_000;\n\ninterface ElectronShell {\n  showItemInFolder(fullPath: string): void;\n}\n\nconst electronShell = rawElectronShell as unknown as ElectronShell;\n',
  "typed Electron shell",
);

const replacements = [
  ["fs.realpath", "realpath"],
  ["fs.readdir", "readdir"],
  ["fs.stat", "stat"],
  ["fs.readFile", "readFile"],
  ["fs.mkdir", "mkdir"],
  ["fs.writeFile", "writeFile"],
  ["fs.rm", "rm"],
  ["path.basename", "basename"],
  ["path.dirname", "dirname"],
  ["path.extname", "extname"],
  ["path.join", "join"],
];
for (const [from, to] of replacements) source = source.replaceAll(from, to);

source = required(
  source,
  '      copyText: "(^|/)\\\\.obsidian/copilot-index-.*\\\\.json$",',
  '      copyText: `${plugin.app.vault.configDir}/copilot-index-*.json`,',
  "dynamic Copilot exclusion path",
);
source = source.replaceAll(".obsidian", "Obsidian");

source = required(
  source,
  'function dehydrateNode(node: StorageNode): CachedStorageNode {\n  const { absolutePath: _absolutePath, children, ...rest } = node;\n  return { ...rest, children: children?.map(dehydrateNode) };\n}',
  'function dehydrateNode(node: StorageNode): CachedStorageNode {\n  return {\n    name: node.name,\n    relativePath: node.relativePath,\n    kind: node.kind,\n    size: node.size,\n    fileCount: node.fileCount,\n    folderCount: node.folderCount,\n    modifiedAt: node.modifiedAt,\n    extension: node.extension,\n    children: node.children?.map(dehydrateNode),\n  };\n}',
  "remove unused absolutePath binding",
);

if (/\\b(?:fs|path)\\./.test(source)) throw new Error("Unconverted Node namespace access remains");
if (source.includes(".obsidian")) throw new Error("Hard-coded .obsidian string remains");
write("src/main.ts", source);

let styles = read("styles.css");
styles = required(styles, ".is-growth { color: var(--vsm-danger) !important; }", ".vsm-view .is-growth { color: var(--vsm-danger); }", "growth specificity");
styles = required(styles, ".is-shrink { color: var(--vsm-success) !important; }", ".vsm-view .is-shrink { color: var(--vsm-success); }", "shrink specificity");
styles = required(
  styles,
  `.vsm-sr-only {\n  position: absolute !important;\n  width: 1px !important;\n  height: 1px !important;\n  padding: 0 !important;\n  margin: -1px !important;\n  overflow: hidden !important;\n  clip: rect(0, 0, 0, 0) !important;\n  white-space: nowrap !important;\n  border: 0 !important;\n}`,
  `.vsm-view .vsm-sr-only {\n  position: absolute;\n  width: 1px;\n  height: 1px;\n  padding: 0;\n  margin: -1px;\n  overflow: hidden;\n  clip: rect(0, 0, 0, 0);\n  white-space: nowrap;\n  border: 0;\n}`,
  "screen reader utility specificity",
);
if (styles.includes("!important")) throw new Error("Unexpected !important remains");
write("styles.css", styles);

const manifest = JSON.parse(read("manifest.json"));
manifest.version = "1.0.4";
write("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);

const versions = JSON.parse(read("versions.json"));
versions["1.0.4"] = manifest.minAppVersion;
write("versions.json", `${JSON.stringify(versions, null, 2)}\n`);

const pkg = JSON.parse(read("package.json"));
pkg.version = "1.0.4";
write("package.json", `${JSON.stringify(pkg, null, 2)}\n`);

const lock = JSON.parse(read("package-lock.json"));
lock.version = "1.0.4";
if (lock.packages?.[""]) lock.packages[""].version = "1.0.4";
write("package-lock.json", `${JSON.stringify(lock, null, 2)}\n`);

let build = read("esbuild.config.mjs");
build = build.replace("Vault Storage Map v1.0.3", "Vault Storage Map v1.0.4");
write("esbuild.config.mjs", build);

write("RELEASE_NOTES_1.0.4.md", `# Vault Storage Map 1.0.4\n\nCommunity review cleanup:\n\n- Remove literal assumptions about the vault configuration folder name.\n- Use typed named Node.js imports instead of namespace imports.\n- Type the Electron shell boundary explicitly.\n- Remove an unused cache serialization binding.\n- Replace CSS !important declarations with stronger scoped selectors.\n\nThe direct filesystem and clipboard notices remain intentional because they are required for disk-usage scanning, revealing files in the system explorer, and copying paths.\n`);

for (const file of [
  "tools/apply-community-cleanup-1.0.4.mjs",
  ".github/workflows/publish-1.0.4.yml",
  "tools/apply-community-blocker-fixes-1.0.3.mjs",
  ".github/workflows/publish-1.0.3.yml",
]) fs.rmSync(file, { force: true });
