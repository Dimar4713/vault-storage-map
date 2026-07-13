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
  '  setIcon,\n} from "obsidian";',
  '  setIcon,\n  getLanguage,\n  activeDocument,\n} from "obsidian";',
  "Obsidian imports",
);

source = source.replace('const INTERNAL_EXCLUDED_PATHS = new Set([".obsidian/plugins/vault-storage-map/storage-cache-v1.json"]);\n', "");

source = required(
  source,
  '    private readonly settings: VaultStorageMapSettings,\n    private readonly signal: AbortSignal,',
  '    private readonly settings: VaultStorageMapSettings,\n    private readonly configDir: string,\n    private readonly signal: AbortSignal,',
  "VaultScanner configDir",
);

source = required(
  source,
  '    if (INTERNAL_EXCLUDED_PATHS.has(normalized)) return true;\n    if (!this.settings.includeHidden && name.startsWith(".")) return true;\n    if (!this.settings.includeObsidianConfig && (normalized === ".obsidian" || normalized.startsWith(".obsidian/"))) return true;',
  '    const normalizedConfigDir = this.configDir.replace(/\\\\/g, "/");\n    const internalCachePath = `${normalizedConfigDir}/plugins/vault-storage-map/storage-cache-v1.json`;\n    if (normalized === internalCachePath) return true;\n    if (!this.settings.includeHidden && name.startsWith(".")) return true;\n    if (!this.settings.includeObsidianConfig && (normalized === normalizedConfigDir || normalized.startsWith(`${normalizedConfigDir}/`))) return true;',
  "dynamic configDir filtering",
);

source = required(source, 'id: "open-vault-storage-map"', 'id: "open-storage-map"', "open command id");
source = required(source, 'id: "scan-vault-storage"', 'id: "scan-storage"', "scan command id");
source = required(
  source,
  '    const candidate = (window.localStorage.getItem("language") || navigator.language || "en").toLowerCase();',
  '    const candidate = (getLanguage() || navigator.language || "en").toLowerCase();',
  "language detection",
);
source = required(
  source,
  '    const scanner = new VaultScanner(basePath, this.settings, this.scanController.signal, (progress) => {',
  '    const scanner = new VaultScanner(basePath, this.settings, this.app.vault.configDir, this.scanController.signal, (progress) => {',
  "scanner construction",
);
source = required(
  source,
  '    return path.join(base, this.manifest.dir ?? ".obsidian/plugins/vault-storage-map", "storage-cache-v1.json");',
  '    return path.join(base, this.app.vault.configDir, "plugins", this.manifest.id, "storage-cache-v1.json");',
  "cache path",
);

source = source.replaceAll(
  'folders.find((node) => node.relativePath === ".obsidian")',
  'folders.find((node) => node.relativePath === this.app.vault.configDir)',
);
source = source.replaceAll(
  'folders.find((folder) => folder.relativePath === ".obsidian")',
  'folders.find((folder) => folder.relativePath === plugin.app.vault.configDir)',
);
source = source.replaceAll("document.createElement", "activeDocument.createElement");
source = source.replaceAll("requestAnimationFrame(", "window.requestAnimationFrame(");

write("src/main.ts", source);

const manifest = JSON.parse(read("manifest.json"));
manifest.version = "1.0.2";
write("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);

const versions = JSON.parse(read("versions.json"));
versions["1.0.2"] = manifest.minAppVersion;
write("versions.json", `${JSON.stringify(versions, null, 2)}\n`);

const pkg = JSON.parse(read("package.json"));
pkg.version = "1.0.2";
delete pkg.devDependencies["builtin-modules"];
write("package.json", `${JSON.stringify(pkg, null, 2)}\n`);

const lock = JSON.parse(read("package-lock.json"));
lock.version = "1.0.2";
if (lock.packages?.[""]) {
  lock.packages[""].version = "1.0.2";
  delete lock.packages[""].devDependencies?.["builtin-modules"];
}
delete lock.packages?.["node_modules/builtin-modules"];
write("package-lock.json", `${JSON.stringify(lock, null, 2)}\n`);

write("RELEASE_NOTES_1.0.2.md", `# Vault Storage Map 1.0.2\n\nObsidian Community compatibility improvements:\n\n- Respect the vault's configured configuration directory through Vault.configDir.\n- Use Obsidian getLanguage() for automatic language detection.\n- Use command IDs without repeating the plugin ID.\n- Improve popout-window compatibility with activeDocument and window.requestAnimationFrame().\n- Remove the obsolete builtin-modules development dependency.\n`);

fs.rmSync("tools/apply-community-warning-fixes.mjs", { force: true });
fs.rmSync(".github/workflows/apply-community-warning-fixes.yml", { force: true });
