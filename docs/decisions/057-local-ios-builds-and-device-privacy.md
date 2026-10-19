# ADR-057: Local iOS builds and registered-device privacy

## Status

Accepted, 2026-10-20. Supersedes the iOS hosting and distribution parts of
[ADR-055](055-mobile-device-build-workflows.md). Android and desktop build channels are unchanged.

## Context

The repository is public. Development and Ad Hoc iOS IPAs embed provisioning profiles that list registered device
UDIDs and identify the Apple development team. Storing the input profiles in GitHub Secrets does not hide the profiles
inside the resulting IPA. Choosing not to create a Release also does not protect an IPA uploaded to public Actions
artifacts: signed-in users with read access can download those artifacts.

The maintainer chose local iOS builds instead of hosted iOS packages. Existing Release and tag cleanup remains a
separate maintainer action; downloaded copies cannot be recalled by removing the originals.

## Decision

- Remove the registered-device IPA workflow and the iOS target from the unsigned Apple workflow. No GitHub workflow
  builds, signs, uploads or publishes an iOS package. Narrow the remaining macOS upload paths to macOS outputs.
- Keep the local Xcode project, development signing, profile validation and IPA packaging tools. The main app's and
  Share Extension's profiles and the private signing identity remain on the maintainer's Mac. Local signing still
  validates both bundles and their authorized device sets.
- Do not upload device IPAs, real profiles or real-device data backups to public Releases, Actions artifacts or Git.
  Removing historical iOS artifacts is authorized separately from deleting published Releases or tags.
- Preserve the current app identity and version records. Moving build location does not require a version bump,
  application reinstall, signing-key rotation or store submission.
- Android's fixed-key workflow and the desktop workflows continue under their existing authorization rules.

## Consequences

### Positive

- Future hosted builds cannot publish the iOS device list through either Release assets or Actions artifacts.
- iOS device updates can keep the existing identity and data using the local build and installation tools.

### Negative

- iOS device builds require the maintainer's Mac, Xcode, a valid signing identity and current local profiles.
- Any later TestFlight or other hosted iOS distribution needs a new explicit decision and authorization.

### Neutral

- Apple team identity and public signing certificates are separate from private signing keys. Existing public
  Developer ID macOS packages identify the developer but do not use an iOS registered-device list.

## Alternatives Considered

### Keep uploading IPAs but skip Release publication

Rejected: a public Actions artifact still permits others to obtain the embedded device list.

### Upload an encrypted IPA or use private build storage

Could protect the package with separate access controls, but the maintainer selected local builds for now.

### Remove or redact the embedded profile

Rejected: the signed profile authorizes device installation and cannot be edited to hide the list while preserving
its signature and the required authorization.

## References

- [Local iOS build procedure](../deployment.md#ios-local-builds), [Apple native host](../../src/native/apple/README.md).
- [Apple TN3125: provisioning profiles](https://developer.apple.com/documentation/technotes/tn3125-inside-code-signing-provisioning-profiles).
- [GitHub workflow artifact access](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/download-workflow-artifacts).

---

*Decision made: 2026-10-20*
*Decision maker: Project maintainer*
