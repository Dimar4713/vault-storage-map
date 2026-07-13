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
  "const MAX_CACHED_NODES = 50_000;\n",
  `const MAX_CACHED_NODES = 50_000;\n\nfunction hasErrorCode(error: unknown, code: string): boolean {\n  return typeof error === \"object\" && error !== null && \"code\" in error && error.code === code;\n}\n`,
  "add safe error code guard",
);
source = required(
  source,
  '      if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.warn("Vault Storage Map cache load failed", error);',
  '      if (!hasErrorCode(error, "ENOENT")) console.warn("Vault Storage Map cache load failed", error);',
  "replace unsafe errno member access",
);
write("src/main.ts", source);

const manifest = JSON.parse(read("manifest.json"));
manifest.version = "1.0.6";
write("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);

const versions = JSON.parse(read("versions.json"));
versions["1.0.6"] = manifest.minAppVersion;
write("versions.json", `${JSON.stringify(versions, null, 2)}\n`);

const pkg = JSON.parse(read("package.json"));
pkg.version = "1.0.6";
write("package.json", `${JSON.stringify(pkg, null, 2)}\n`);

const lock = JSON.parse(read("package-lock.json"));
lock.version = "1.0.6";
if (lock.packages?.[""]) lock.packages[""].version = "1.0.6";
write("package-lock.json", `${JSON.stringify(lock, null, 2)}\n`);

let build = read("esbuild.config.mjs");
build = build.replace("Vault Storage Map v1.0.5", "Vault Storage Map v1.0.6");
write("esbuild.config.mjs", build);

write("RELEASE_NOTES_1.0.6.md", `# Vault Storage Map 1.0.6\n\nFinal Community review cleanup:\n\n- Replace the last unsafe error-code member access with an explicit unknown-safe type guard.\n- Keep the existing Obsidian 1.7.2 minimum version and runtime behavior unchanged.\n\nThe filesystem and clipboard notices remain intentional. The legacy display() settings entry point remains for compatibility with Obsidian versions before 1.13.0.\n`);

for (const file of [
  "tools/apply-final-review-cleanup-1.0.6.mjs",
  ".github/workflows/publish-1.0.6.yml",
  "tools/apply-final-typing-cleanup-1.0.5.mjs",
  ".github/workflows/publish-1.0.5.yml",
]) fs.rmSync(file, { force: true });
