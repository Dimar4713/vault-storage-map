import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");
const write = (file, content) => fs.writeFileSync(file, content, "utf8");

let source = read("src/main.ts");

const replacements = [
  [
    '  onunload(): void {\n    this.scanController?.abort();\n    this.app.workspace.detachLeavesOfType(VIEW_TYPE_STORAGE_MAP);\n  }',
    '  onunload(): void {\n    this.scanController?.abort();\n  }',
    "remove detachLeavesOfType from onunload",
  ],
  [
    '    this.app.workspace.revealLeaf(leaf);',
    '    await this.app.workspace.revealLeaf(leaf);',
    "await revealLeaf",
  ],
  [
    '    containerEl.createEl("h2", { text: this.plugin.t("settingsTitle") });',
    '    new Setting(containerEl).setName(this.plugin.t("settingsTitle")).setHeading();',
    "use Setting.setHeading",
  ],
];

for (const [from, to, label] of replacements) {
  if (!source.includes(from)) throw new Error(`Pattern not found: ${label}`);
  source = source.replace(from, to);
}

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
write("package.json", `${JSON.stringify(pkg, null, 2)}\n`);

const lock = JSON.parse(read("package-lock.json"));
lock.version = "1.0.1";
if (lock.packages?.[""]) lock.packages[""].version = "1.0.1";
write("package-lock.json", `${JSON.stringify(lock, null, 2)}\n`);

write("RELEASE_NOTES_1.0.1.md", `# Vault Storage Map 1.0.1\n\nObsidian Community review fixes:\n\n- Preserve custom view placement when the plugin unloads.\n- Await workspace view activation.\n- Use the Obsidian settings heading API.\n- Require Obsidian 1.7.2 or newer.\n`);
