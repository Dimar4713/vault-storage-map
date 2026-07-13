# Publishing checklist

## 1. Create the repository

Create a public repository named `Dimar4713/vault-storage-map`, enable Issues, and push the contents of this project with `manifest.json` at the repository root.

## 2. Validate locally

```bash
npm ci
npm run check
npm run build
node --check main.js
```

## 3. Test platforms

- [x] Windows 10 acceptance test
- [ ] macOS desktop smoke test
- [ ] Linux desktop smoke test
- [ ] Minimum declared app version (`1.6.0`) compatibility test or adjustment

## 4. Create the release

Commit and push, then create and push the exact tag:

```bash
git tag 1.0.0
git push origin 1.0.0
```

The release workflow verifies that the tag matches `manifest.json` and uploads `main.js`, `manifest.json`, and `styles.css` as individual assets.

## 5. BRAT beta

Before official submission, add the repository through BRAT and collect feedback from macOS and Linux users.

## 6. Community Plugins pull request

Append the object from `community-plugin-entry.json` to the end of `community-plugins.json` in a fork of `obsidianmd/obsidian-releases`. Change no other file.

Use `docs/OBSIDIAN_PR_BODY.md` as the pull request body and mark only checks that are actually complete.
