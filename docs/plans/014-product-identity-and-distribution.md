# PLAN-014: Product identity cutover and Release distribution

## Metadata

| Field | Value |
|---|---|
| Status | In progress; final build IDs and local Google settings applied, native signing and service acceptance pending |
| Owner | Project maintainer |
| Assigned To | Unassigned |
| Reviewer | Independent implementation reviewer and maintainer on real devices |

## Related Spec

[SPEC-013](../specs/013-product-identity-and-distribution.md), with the authoritative identity table in
[ADR-069](../decisions/069-pin-it-anywhere-product-identity.md) and distribution policy in
[ADR-070](../decisions/070-release-channels-and-architecture.md).

## Overview

Separate local implementation from external account changes, then verify the transition using real installed builds.
The phases below separate completed source work from pending acceptance. A documentation commit neither renames the
remote repository nor creates cloud projects, modifies credentials, dispatches workflows or submits store builds.
Apply the existing authorization rules when those actions are requested; do not ask again for authorization already
supplied for the same action.

## Implementation Phases

### Phase 1: Resolve identities and protect existing data

- [ ] Inventory current app IDs, OAuth clients, Apple profiles/entitlements, Windows publisher, local storage paths,
  credential access groups and installed versions without exposing secrets.
- [ ] Confirm desired Cloud project-ID availability and domain control; settle the remaining Windows/store, Linux,
  deep-link, release-file and public contact/URL identities identified by ADR-069.
- [ ] Review V1 format freeze and backup compatibility before external beta; record a specific follow-up decision if
  the existing data policy must change, rather than adding speculative migration machinery.
- [ ] Preserve local notes and verify their recovery before retiring any old installation. For this maintainer's
  identity cutover only, preservation/restore of the old Google Drive notes was waived on 2026-11-13; use a fresh new
  project without importing them. No cloud deletion or credential revocation is needed for that transition. The
  general backup/restore product requirements remain in force for other users.

**Deliverable**: a concrete identity mapping and verified recovery route for FR01–FR05 and FR13.

### Phase 2: Apply names and service/signing configuration

- [ ] Update locale/native display names, manifests, app/extension IDs, App Group, launcher/share metadata and store
  drafts together. Keep internal names unless a public identity or build contract actually depends on them.
  - [x] Update renderer/native names, window titles, Apple/Android localized system-name resources, Linux desktop/startup
    names, Windows English package display names, DMG application names and store/privacy drafts. Keep technical IDs,
    storage paths, signing subjects and existing public artifact filenames until their cutover is ready.
  - [x] Set final Apple/Android build defaults and Apple local configuration; keep Windows package identity independent
    of the shared mobile ID. Preserve internal storage names and installed data.
  - [ ] Complete Android OAuth, Apple registrations/profiles, localized Windows package resources and native installed
    acceptance. The new Google project exists; new-client live acceptance is pending.
- [ ] Register the new Google project/clients and Apple IDs/profiles when authorized. Derive callbacks from actual
  clients, and register each Android distribution fingerprint, including the Play app-signing fingerprint.
  - [x] Apply the maintainer-supplied new-project Desktop, macOS, iOS and Web clients to ignored local settings. Validate
    the Desktop JSON's project/client/full secret and use it for Windows/Linux without exposing its value.
  - [ ] Configure the missing new Android client and Apple IDs/App Group/profiles; switch CI service settings as a
    separate external configuration step. Verify Google API/consent settings and real sign-in.
- [ ] Configure OAuth branding, privacy/support pages and contacts; keep private keys and tokens out of public config.
- [ ] Rename the GitHub repo when authorized; update remotes, links, update source, workflow assumptions and future asset
  names together. Verify how an already installed old build reaches the new source before relying on redirects.
  - [x] Rename the repository and local remote to `sammykenny2/pin-it-anywhere`; use that repository as the generated
    update-source default. Workflows already derive their release repository from `GITHUB_REPOSITORY`.
  - [ ] Finish future asset naming with the distribution-contract changes. Old installed updaters require a manual
    transition because the redirected Atom feed names the new repository; native install/update acceptance is pending.
- [ ] Test old/new Google app-data visibility, fresh sign-in, token refresh, account isolation, sharing and backup/restore
  in the new app identity. Document any required manual transition instead of claiming an in-place upgrade.

**Deliverable**: consistent product identity and actual service configuration, accepted under C01–C04.

### Phase 3: Enforce the distribution artifact contract

- [ ] Change Android external-delivery paths from Debug to signed Release APK/AAB; preserve Debug only for development
  and isolated CI tests. Configure upload/Play keys separately and validate the final app-signing identity.
- [ ] After Certum issuance, verify signing-tool compatibility, timestamp, trust chain and Publisher, then sign Windows
  distribution artifacts without exporting a CER into the public delivery set.
- [ ] Update packaging workflows, release asset allowlists, metadata writers, tests and install instructions as one
  change: reject CER/Debug assets, omit the public Windows unpackaged ZIP and retain necessary macOS update ZIPs.
- [ ] Add artifact inspection for Release configuration and distribution entitlements; distinguish configuration from
  channel names and keep CI's non-distributed Debug probes working.
- [ ] Update deployment procedures and both editions of affected user-facing documents to match implemented behavior.

**Deliverable**: FR06–FR07 and C05; no new release or version number is implied.

### Phase 4: Add native Windows ARM64 and verify desktop delivery

- [ ] Parameterize Windows runtime/package architecture across builds, native dependencies, manifest, notices, package
  inspection, update metadata and installer validation. Replace the hardcoded updater x64 selection.
- [ ] Build native x64 and ARM64 packages and an MSIX bundle; verify compatible selection and old-to-new update paths,
  including the transition from the existing x64 package and any changed identity/publisher.
- [ ] Verify macOS DMG first install, Universal contents, runtime on both CPUs and subsequent Sparkle ZIP update.
- [ ] Verify Linux DEB dependencies, desktop/startup integration and in-app install/cancel on supported real systems.

**Deliverable**: FR08–FR10 and C06–C08, with explicit untested-device boundaries.

### Phase 5: Run mobile beta and collect feedback

- [ ] Create the Play application with the final identity and configure Play App Signing, store data/privacy and a
  closed test; recheck account-specific requirements and recruit the project target of real testers.
- [ ] Create the App Store Connect app, archive Release for distribution, configure TestFlight external testing and
  complete the applicable beta review without exposing local development profiles publicly.
- [ ] Choose a feedback destination and give testers capture, editing, local/cloud, sync, sharing, backup and restart
  scenarios; triage feedback into ordinary fixes and repeat affected acceptance checks.
- [ ] Before requesting production access/submission, check actual test eligibility, outstanding defects, signing,
  screenshots, privacy disclosures and format compatibility. Obtain the applicable release/submission authorization.

**Deliverable**: FR12 and C09, with feedback used in development. Store decisions and run outcomes stay in their
external systems and the conversation; do not add tracked post-release bookkeeping.

### Later optional phase: AppImage or alternative installers

- [ ] Design and verify a compatible AppImage runtime, stable startup path, menu integration and signed/verified update
  mechanism before advertising this format. Keep DEB as the initial installer.
- [ ] Revisit PKG or NSIS only for a concrete installation need; implement the corresponding signing and lifecycle
  acceptance before offering them. These are not prerequisites for the selected primary installers.

## Files to Create/Modify

| Area | Expected changes |
|---|---|
| `src/i18n/locales/`, native string tables and platform manifests | Localized display names and app/extension metadata |
| `.env.example`, config generation, Apple config/entitlements, Android Gradle and Windows package generation | Public IDs and actual signing/OAuth associations |
| `.github/workflows/`, `scripts/validate-release-assets.mjs`, platform packagers and update writers | Release-only asset contract and architecture-aware delivery |
| `src/native/windows/` and its updater | ARM64 runtime/package support and MSIX bundle validation |
| Existing packaging, update-feed, i18n and native tests | Regression coverage of the changed contracts |
| `docs/deployment.md`, `docs/testing.md`, platform READMEs and paired user/store guides | Actual procedures and verification boundaries |

## Testing Strategy

Run targeted configuration, i18n, packaging, asset-contract and update-feed tests for each implementation slice, then
the documented shared checks. Inspect the actual signed artifacts and run SPEC-013's native acceptance cases;
source-text checks, a successful compiler or x64 emulation cannot replace them. Independent review is separate from
author-run tests. Record procedures and unverified limits in testing docs, with run/release outcomes in the conversation.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| New identity loses access to old encrypted/cloud data | Keep old access, complete exports and prove restore before cutover |
| Publisher or package identity changes block an update | Test installed old-to-new transition; require an explicit manual route when necessary |
| Old updater rejects renamed metadata or ARM64/bundle assets | Change producer, validator and consumer together; test old installs |
| Store signing differs from local upload/debug signatures | Verify actual distributed artifact fingerprints and native OAuth |
| Optional installer exposes nonfunctional settings | Gate the format on full startup/update acceptance |

---

*Created: 2026-11-13*
