import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const write = (path, content) => fs.writeFileSync(path, content, "utf8");
const replaceRequired = (source, from, to, label) => {
  if (!source.includes(from)) throw new Error(`Pattern not found: ${label}`);
  return source.replace(from, to);
};

let source = read("src/main.ts");
source = replaceRequired(
  source,
  '  setIcon,\n} from "obsidian";',
  '  setIcon,\n  getLanguage,\n} from "obsidian";',
  "getLanguage import",
);
source = source.replace('const INTERNAL_EXCLUDED_PATHS = new Set([".obsidian/plugins/vault-storage-map/storage-cache-v1.json"]);\n', "");
source = replaceRequired(
  source,
  '    private readonly settings: VaultStorageMapSettings,\n    private readonly signal: AbortSignal,',
  '    private readonly settings: VaultStorageMapSettings,\n    private readonly configDir: string,\n    private readonly signal: AbortSignal,',
  "scanner configDir parameter",
);
source = replaceRequired(
  source,
  '    if (INTERNAL_EXCLUDED_PATHS.has(normalized)) return true;\n    if (!this.settings.includeHidden && name.startsWith(".")) return true;\n    if (!this.settings.includeObsidianConfig && (normalized === ".obsidian" || normalized.startsWith(".obsidian/"))) return true;',
  '    const normalizedConfigDir = this.configDir.replace(/\\\\/g, "/");\n    const internalCachePath = `${normalizedConfigDir}/plugins/vault-storage-map/storage-cache-v1.json`;\n    if (normalized === internalCachePath) return true;\n    if (!this.settings.includeHidden && name.startsWith(".")) return true;\n    if (!this.settings.includeObsidianConfig && (normalized === normalizedConfigDir || normalized.startsWith(`${normalizedConfigDir}/`))) return true;',
  "dynamic config directory filtering",
);
source = replaceRequired(source, 'id: "open-vault-storage-map"', 'id: "open-storage-map"', "open command id");
source = replaceRequired(source, 'id: "scan-vault-storage"', 'id: "scan-storage"', "scan command id");
source = replaceRequired(
  source,
  '  onunload(): void {\n    this.scanController?.abort();\n    this.app.workspace.detachLeavesOfType(VIEW_TYPE_STORAGE_MAP);\n  }',
  '  onunload(): void {\n    this.scanController?.abort();\n  }',
  "onunload leaf handling",
);
source = replaceRequired(
  source,
  '    const candidate = (window.localStorage.getItem("language") || navigator.language || "en").toLowerCase();',
  '    const candidate = (getLanguage() || navigator.language || "en").toLowerCase();',
  "language detection",
);
source = replaceRequired(source, '    this.app.workspace.revealLeaf(leaf);', '    await this.app.workspace.revealLeaf(leaf);', "await revealLeaf");
source = replaceRequired(
  source,
  '    const scanner = new VaultScanner(basePath, this.settings, this.scanController.signal, (progress) => {',
  '    const scanner = new VaultScanner(basePath, this.settings, this.app.vault.configDir, this.scanController.signal, (progress) => {',
  "scanner construction",
);
source = replaceRequired(
  source,
  '    return path.join(base, this.manifest.dir ?? ".obsidian/plugins/vault-storage-map", "storage-cache-v1.json");',
  '    return path.join(base, this.app.vault.configDir, "plugins", this.manifest.id, "storage-cache-v1.json");',
  "cache path",
);
source = source.replace(
  '    const obsidianFolder = folders.find((node) => node.relativePath === ".obsidian");',
  '    const obsidianFolder = folders.find((node) => node.relativePath === this.app.vault.configDir);',
);
source = source.replace(
  '  const obsidianFolder = folders.find((folder) => folder.relativePath === ".obsidian");',
  '  const obsidianFolder = folders.find((folder) => folder.relativePath === plugin.app.vault.configDir);',
);
source = replaceRequired(
  source,
  '    containerEl.createEl("h2", { text: this.plugin.t("settingsTitle") });',
  '    new Setting(containerEl).setName(this.plugin.t("settingsTitle")).setHeading();',
  "settings heading",
);
write("src/main.ts", source);

const manifest = JSON.parse(read("manifest.json"));
manifest.version = "1.0.1";
manifest.minAppVersion = "1.7.2";
write("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);

const versions = JSON.parse(read("versions.json"));
versions["1.0.1"] = "1.7.2";
write("versions.json", `${JSON.stringify(versions, null, 2)}\n`);

const pkg = JSON.parse(read("package.json"));
pkg.version = "1.0.1";
pkg.devDependencies.typescript = "5.7.2";
write("package.json", `${JSON.stringify(pkg, null, 2)}\n`);

const lock = JSON.parse(read("package-lock.json"));
lock.version = "1.0.1";
if (lock.packages?.[""]) lock.packages[""].version = "1.0.1";
write("package-lock.json", `${JSON.stringify(lock, null, 2)}\n`);

write(".github/workflows/release.yml", `name: Release

on:
  push:
    tags:
      - "[0-9]+.[0-9]+.[0-9]+"

permissions:
  contents: write
  id-token: write
  attestations: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build
      - name: Validate tag and manifest version
        shell: bash
        run: |
          VERSION=$(node -p "require('./manifest.json').version")
          test "$VERSION" = "$GITHUB_REF_NAME"
      - name: Attest release assets
        uses: actions/attest-build-provenance@v3
        with:
          subject-path: |
            main.js
            manifest.json
            styles.css
      - name: Publish GitHub release
        shell: bash
        env:
          GH_TOKEN: \${{ github.token }}
        run: |
          if [ -f "RELEASE_NOTES_\${GITHUB_REF_NAME}.md" ]; then
            gh release create "$GITHUB_REF_NAME" main.js manifest.json styles.css \\
              --title "$GITHUB_REF_NAME" \\
              --notes-file "RELEASE_NOTES_\${GITHUB_REF_NAME}.md"
          else
            gh release create "$GITHUB_REF_NAME" main.js manifest.json styles.css \\
              --title "$GITHUB_REF_NAME" \\
              --generate-notes
          fi
`);

write("RELEASE_NOTES_1.0.1.md", `# Vault Storage Map 1.0.1

Community review fixes:

- Preserve custom view placement when the plugin unloads.
- Await workspace view activation and require Obsidian 1.7.2 or newer.
- Use the Obsidian settings heading API.
- Respect the configured vault configuration directory instead of assuming .obsidian.
- Use Obsidian language detection and simplified command IDs.
- Add GitHub artifact attestations for release assets.
`);

fs.rmSync("tools/apply-community-review-fixes.mjs", { force: true });
fs.rmSync(".github/workflows/apply-community-review-fixes.yml", { force: true });
