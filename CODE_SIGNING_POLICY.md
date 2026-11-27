# Code signing policy

## Current status

PartyUp is preparing an application to the SignPath Foundation program. Approval and production signing are pending. Published Windows releases, including version 0.3.1, are unsigned. This page does not claim that SignPath currently provides signing for PartyUp.

If the application is approved, the intended attribution is: Free code signing provided by [SignPath.io](https://signpath.io), certificate by [SignPath Foundation](https://signpath.org).

## Project and responsibilities

- Project: PartyUp.
- Source repository: [vowanchik/DegradCalendar](https://github.com/vowanchik/DegradCalendar).
- Author and committer: [Vladimir Rozhnov (@vowanchik)](https://github.com/vowanchik).
- Reviewer of external contributions: Vladimir Rozhnov (@vowanchik).
- Intended signing approver: Vladimir Rozhnov (@vowanchik).

External contributions must be reviewed by the maintainer before integration. A production signing request will require the maintainer's manual approval. Repository and SignPath account access must use multi-factor authentication; account configuration must be confirmed before production signing is enabled.

## Intended signing scope

Signing is intended for PartyUp's own Windows application executable and portable distribution package built from this repository. The GitHub Actions Windows build workflow produces unsigned artifacts for inspection; it does not currently submit signing requests or publish signed releases.

Before enabling SignPath signing, the maintainer must configure build-origin verification, enforce PartyUp product and version metadata, and verify both the inner application executable and the outer portable package. Unmodified third-party binaries must not be re-signed using the project's signing authorization. Android and iOS signing are separate from this Windows signing application.

## Privacy

See the [PartyUp privacy policy](PRIVACY.md), including the chosen server, Steam content, Google Fonts, and optional Firebase/APNs push notifications.
