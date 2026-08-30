# AGENTS.md — Vault Storage Map

## Scope

These rules apply to the whole `vault-storage-map` repository. Narrower `AGENTS.md` files may strengthen but not weaken them.

Canonical AIMETON-wide governance: `Dimar4713/aimeton-architecture/AGENTS.md`.

## Repository mission

Vault Storage Map is a released local-first desktop plugin for read-only storage analysis. Privacy, filesystem safety, offline behavior and release compatibility are first-class invariants.

## Before work

1. Read `README.md`, manifest/package metadata, privacy/release docs, active Issues/PR/CI and exact current SHA.
2. For cross-repository work, read root `AGENTS.md` of every touched AIMETON repository before first mutation.
3. Distinguish planned, implemented, observed and verified behavior.

## 3×3 Reality Check

Before blocker, root-cause, filesystem/privacy claim, compatibility/release decision or consequential write, treat the first explanation as a hypothesis.

Check architecture/lifecycle, alternatives/control paths, history/live; source/contract, runtime/live, independent evidence; perform falsification.

`no access`, `impossible`, `only path`, `safe`, `no network`, or `release ready` are provisional until the applicable evidence is checked.

## GitHub / execution fallback

Before manual owner action, check:

`GitHub connector/API → AIMETON GitHub MCP/router → REST/GraphQL/gh through trusted AIMETON server → owner`.

A limitation of one connector/token/workflow does not prove a system-level AIMETON limitation. Never expose secrets or private vault data.

## Continuous Mission / Motor State

```text
READ → DECIDE → ACTION → READ-BACK → EVIDENCE → NEXT SAFE ACTION
```

After each material action verify the result and execute the next safe unambiguous step unless an objective authority blocker exists. Absence of a new owner message is not a blocker. Maintain current → next → following actions and perform MOTOR-CHECK/STOP-CHECK before ending a tool session.

## Privacy and filesystem invariants

1. Storage scanning is read-only with respect to user vault contents.
2. Do not read note contents when metadata is sufficient for storage analysis.
3. No telemetry, accounts or network transfer of vault data may be introduced without an explicit product/privacy decision.
4. Automatic deletion or cleanup of user files is forbidden.
5. Writes are limited to documented local settings/cache and explicit user-triggered report exports.
6. Generated cache must remain excluded from its own scan totals.
7. Symbolic-link behavior must remain explicit; never silently expand scan scope outside the vault.
8. Private/local paths and user data must not appear in public fixtures, logs, Issues or evidence.

## Release / compatibility boundary

A GREEN build or PR does not prove release readiness. Verify manifest/version, generated release files, supported app/runtime versions and release assets/read-back when releasing.

Do not change plugin identity, compatibility floor, privacy contract or generated-file set as an incidental refactor.

## Cross-repository provenance

If AIMETON-wide standards, assets or infrastructure facts are projected into this repository, use canonical source references with exact source SHA/path/blob/digest where applicable. Do not maintain independent mutable copies as authoritative truth.

## Authority boundary

Without owner authorization do not introduce paid/network services, weaken privacy, make irreversible user-data operations, change license/public-release boundaries, or expose secrets/private data.

## Definition of Done

Applicable items are mandatory:

- source/tests/build checks updated;
- privacy/filesystem invariants verified;
- release metadata/read-back verified when applicable;
- docs synchronized;
- next safe action executed or exact blocker recorded;
- strong conclusions passed 3×3.
