import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");
const write = (file, value) => fs.writeFileSync(file, value, "utf8");
const replaceRequired = (source, from, to, label) => {
  if (!source.includes(from)) throw new Error(`Pattern not found: ${label}`);
  return source.replace(from, to);
};

let source = read("src/main.ts");
source = replaceRequired(
  source,
  '  setIcon,\n  getLanguage,\n} from "obsidian";',
  '  setIcon,\n} from "obsidian";\nimport { shell as electronShell } from "electron";',
  "remove unsupported getLanguage and add Electron ESM import",
);
source = replaceRequired(
  source,
  'const electronShell = (require("electron") as { shell: { showItemInFolder: (fullPath: string) => void } }).shell;\n',
  "",
  "remove require electron",
);
source = replaceRequired(
  source,
  '    const candidate = (getLanguage() || navigator.language || "en").toLowerCase();',
  '    const candidate = (navigator.language || "en").toLowerCase();',
  "language fallback",
);
source = replaceRequired(
  source,
  '    this.registerDomEvent(document, "keydown", (event: KeyboardEvent) => {\n      if (event.key !== "Escape" || !this.plugin.scanPromise) return;\n      if (!this.containerEl.contains(document.activeElement)) return;',
  '    const activeDocument = this.containerEl.ownerDocument;\n    this.registerDomEvent(activeDocument, "keydown", (event: KeyboardEvent) => {\n      if (event.key !== "Escape" || !this.plugin.scanPromise) return;\n      if (!this.containerEl.contains(activeDocument.activeElement)) return;',
  "popout document compatibility",
);
write("src/main.ts", source);

const manifest = JSON.parse(read("manifest.json"));
manifest.version = "1.0.3";
write("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);

const versions = JSON.parse(read("versions.json"));
versions["1.0.3"] = manifest.minAppVersion;
write("versions.json", `${JSON.stringify(versions, null, 2)}\n`);

const pkg = JSON.parse(read("package.json"));
pkg.version = "1.0.3";
write("package.json", `${JSON.stringify(pkg, null, 2)}\n`);

const lock = JSON.parse(read("package-lock.json"));
lock.version = "1.0.3";
if (lock.packages?.[""]) lock.packages[""].version = "1.0.3";
write("package-lock.json", `${JSON.stringify(lock, null, 2)}\n`);

let build = read("esbuild.config.mjs");
build = build.replace("Vault Storage Map v1.0.2", "Vault Storage Map v1.0.3");
write("esbuild.config.mjs", build);

write("RELEASE_NOTES_1.0.3.md", `# Vault Storage Map 1.0.3\n\nObsidian Community review fixes:\n\n- Remove use of an Obsidian API newer than the declared minimum version.\n- Replace CommonJS require() for Electron with a typed ESM import.\n- Use the view ownerDocument for popout-window keyboard handling.\n`);
