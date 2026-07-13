# Vault Storage Map 1.0.6

Final Community review cleanup:

- Replace the last unsafe error-code member access with an explicit unknown-safe type guard.
- Keep the existing Obsidian 1.7.2 minimum version and runtime behavior unchanged.

The filesystem and clipboard notices remain intentional. The legacy display() settings entry point remains for compatibility with Obsidian versions before 1.13.0.
