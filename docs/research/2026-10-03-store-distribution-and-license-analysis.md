# Store distribution, cross-platform capabilities and license research

- Date: 2026-10-03; external policies consulted the same day.
- Status: pre-selection research; no submission or approval result on any platform.
- User requirements: own iOS, macOS and Android apps in the stores; no commercial Windows signing certificate purchase yet; a pragmatically limited Linux release scope.
- This document lists the checking boundaries for adoption and distribution; a single root license is not treated as proof of compliance for every artifact.

## 1. Known release targets

| Platform | Path | Judgement in this session | Unfinished work |
|---|---|---|---|
| macOS | Mac App Store | Must start from public APIs and sandbox compatibility | Desktop-layer probe, signing, packaging and submission |
| iOS | Apple App Store | Needs a capture/editing client that actually works | Phone UX, sync, pairing and release setup |
| Android | Google Play | AAB/Play App Signing is the candidate standard path | App implementation, key custody, account and testing eligibility |
| Windows | Microsoft Store, evaluating MSIX first | The Store signing path fits the current preference of not buying a certificate | MSIX compatibility, desktop interaction and certification tests |
| Linux | Starting with GitHub Releases | Usable as a delivery channel, but does not mean every distro is supported | Decide the distro, CPU, desktop/compositor and packaging matrix |

The web can be used for early UX validation or as an extra editing entry point; it does not replace the stated mobile store requirement.

## 2. Apple: public APIs, sandbox and reviewability

Apple's rules require public APIs; the Mac App Store adds sandbox and update-method requirements. Dynamically downloaded feature code is restricted, and 4.7 sets conditions for some HTML5/JavaScript software and plug-ins; this should not be read as all external JS being certainly forbidden or certainly allowed. Apps that require sign-in or pairing must also be actually accessible to reviewers. [Apple Review Guidelines, 2.4.5/2.5/4.7 and Before You Submit](https://developer.apple.com/app-store/review/guidelines/)

This project's candidate implementation approach:

- First-version feature code ships with the app; what sync retrieves is note and settings data.
- Arbitrary remotely downloaded JS plug-ins are not a first-version feature.
- Pairing and server deployment must offer a reproducible way to review; working only on the developer's private LAN is not enough.
- Public-API desktop capabilities are validated with a separate prototype; see the [macOS research](2026-10-03-macos-public-api-desktop-feasibility.md).
- If a cross-platform framework is used, check the final release artifacts, not only whether the application code calls private APIs.

The above is the implementation strategy proposed by the current research; it does not promise that review will be passed.

## 3. Windows: evaluate MSIX and EXE/MSI separately

Microsoft's MSIX signing documentation says that when distributing through the Store, the Store signs the package; for this path the developer does not need to buy a CA code-signing certificate for public distribution. [MSIX signing guide](https://learn.microsoft.com/en-us/windows/msix/package/sign-msix-package-guide)

This conclusion must not be stretched to "the Store signs any EXE for free". The official package requirements set separate signing requirements for MSI/EXE; some certification pages use "highly recommended" wording. Before formally taking the EXE/MSI path, re-check the latest conditions for that submission method. [Package requirements](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/app-package-requirements?pivots=store-installer-msix), [MSI/EXE certification](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/app-certification-process)

This project validates MSIX first because of the user's certificate preference; it has not been proven that desktop integration works in that packaging. Install, launch, update, removal, the tray, data location and the desktop layer should be tested. Development/sideload signing and store distribution signing also need to be kept separate.

No signing key will be created or exported in this bootstrap.

## 4. Android: distribution and dynamic code

The Android upload key and app signing key serve different purposes. With an AAB, the developer signs the upload bundle, and Play App Signing signs the artifacts users install. [Android App Signing](https://developer.android.com/studio/publish/app-signing)

Production access for a new personal account may require closed testing; Google currently lists, for personal accounts created after 2023-11-13, requirements such as at least 12 testers opted in for 14 consecutive days. Whether this applies depends on the account's conditions, and completing the days is not automatic approval. [Google Play testing requirements](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en)

Google restricts downloading executable code from outside Play; interpreted code has a specific treatment but must still comply with all policies. Whether a plug-in uses JavaScript does not on its own decide compliance. [Device and Network Abuse](https://support.google.com/googleplay/android-developer/answer/16559646?hl=en)

This project first excludes plug-ins and arbitrary remote code execution from the first-version candidate scope. Ordinary data sync and dynamic execution features should be analyzed separately.

## 5. Linux: the support matrix matters more than package extensions

GitHub Releases can publish files, notes and checksums, but a release page gives no guarantee of runtime compatibility.

The following must be recorded together:

- Distribution and version.
- CPU architecture.
- X11 or Wayland.
- Desktop environment and compositor.
- Runtime dependencies and packaging format.
- Which display levels, mouse click-through and shortcuts actually pass.

The wlr-layer-shell protocol provides background, bottom, top and overlay layers; only environments that support the protocol can be implemented this way, and the relative ordering of surfaces on the same layer cannot be assumed fixed. [Protocol text](https://wayland.app/protocols/wlr-layer-shell-unstable-v1)

So this project's engineering inference is: the normal editing window and the special desktop display capabilities should have separately listed support levels. Success on one Wayland compositor does not allow claiming success on all of Wayland, GNOME, KDE or X11.

The candidate starting approach is to validate the package on one available distro/CPU/desktop combination, then expand step by step. deb, AppImage and Flatpak are only candidate packagings, none chosen in this session; no packaging can add the same layer capability to an unsupported compositor.

## 6. Independent development and license boundaries

This project uses the minimal skeleton of the maintainer's project skeleton template; the product research documents were written afresh and bring in no code, assets, lockfiles, data formats or platform modules from other sticky-note applications.

The root currently uses the bootstrap's MIT license, keeping the source notice and adding a notice for this project's original parts. This MIT does not relicense third-party components added later.

MIT permits broad use, modification and distribution, but requires keeping the relevant copyright and permission notice. [MIT text](https://opensource.org/license/mit)

This session records only the bootstrap source actually brought in; see the [third-party notices](../../THIRD-PARTY-NOTICES.md). There is no need to assume existing code dependencies for candidate products that were neither copied nor linked.

## 7. Identifying licenses of candidate components

| Category | Research result | Implication for selection |
|---|---|---|
| MIT/BSD/ISC/Apache-style components | Each license and its notices must still be read | Can be considered; keeping only our own repo's LICENSE is not enough |
| MPL-2.0 | Has covered-file and source availability obligations | Does not mean the whole app must become MPL; track the distributed parts |
| GPL/AGPL | Obligations for modification, combination, redistribution and network use must be evaluated | Not treated as source that can simply be relabelled MIT |
| Obsidian itself | Its software terms apply | Not an MIT app that can be freely forked/repackaged |
| Vikunja | Main body AGPL-3.0-or-later; desktop GPL-3.0-or-later | Self-hosting, modification, API clients and copying the UI must be evaluated separately |

Sources: [Mozilla MPL FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/), [AGPL text](https://www.gnu.org/licenses/agpl-3.0.html), [Obsidian terms](https://obsidian.md/terms), [Vikunja license](https://github.com/go-vikunja/vikunja#license).

AGPL requires offering the corresponding source for modified programs that support network interaction; whether an independent client forms a covered combined work must still be judged by the actual mode of adoption. "It is only HTTP" cannot be used as an automatic exemption, nor can every HTTP client be deemed covered by the AGPL.

## 8. License work after the tech stack is chosen

This is a follow-up checklist that has not been carried out:

1. Pin the actual versions and the full dependency list.
2. Distinguish build tools, test tools, runtime, static/dynamic linking and platform-specific components.
3. Obtain SPDX expressions, full licenses and the required notices.
4. Make specific judgements for copyleft, fonts, icons, images and SDKs.
5. Check the artifacts each store actually distributes, and set up matching notices and a way to provide source.
6. Re-check on version changes, added dependencies or before submission.

No earlier package scan of another program can be reused as the audit result for this new repo. There is no product dependency manifest yet, so no runtime SBOM or store compatibility audit has been done.

## 9. Misjudgements to block early

- A product path that depends on macOS private APIs does not fit the current Mac App Store direction.
- Unlicensed source/assets must not be copied and re-published.
- A probe on one OS cannot support a capability promise for every platform.
- Untested runtimes, store review and sync reliability must stay marked unverified.

Beyond this, there is currently no evidence requiring the product direction of "public APIs, cross-device, simple backlog" to be abandoned.
