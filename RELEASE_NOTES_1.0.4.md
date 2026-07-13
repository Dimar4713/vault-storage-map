# Vault Storage Map 1.0.4

Community review cleanup:

- Remove literal assumptions about the vault configuration folder name.
- Use typed named Node.js imports instead of namespace imports.
- Type the Electron shell boundary explicitly.
- Remove an unused cache serialization binding.
- Replace CSS !important declarations with stronger scoped selectors.

The direct filesystem and clipboard notices remain intentional because they are required for disk-usage scanning, revealing files in the system explorer, and copying paths.
