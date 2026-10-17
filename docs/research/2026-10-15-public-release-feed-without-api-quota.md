# Public release feed and company egress IP quotas

Date: 2026-10-15. Evidence, decisions and run results are kept apart; the decision is in
[ADR-044](../decisions/044-desktop-in-app-updates-from-github-releases.md),
and the results of this round's checks are in the git history (current status in [PROGRESS](../../PROGRESS.md)).

## Official rules

[GitHub REST API rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api#primary-rate-limit-for-unauthenticated-users)
states that unauthenticated requests are counted per source IP, at 60 per hour; it is not 60 for each app, employee
or repo.
So company employees connecting through the same NAT egress share this allowance; checking only manually cannot
guarantee that queries succeed.
This limit is the REST API quota; it does not mean every public GitHub URL shares the same quota.

## 2026-10-15 tests

Queried from the same computer without a token; GitHub and the installed app were not modified:

| Entry point | Result |
|---|---|
| This repo's `api.github.com/repos/.../releases?per_page=30` | 403; `X-RateLimit-Limit: 60`, `X-RateLimit-Remaining: 0`, the body says the API quota is exhausted |
| This repo's `github.com/.../releases.atom` | 200 |
| The public `releases.atom` of the Electron reference project the maintainer named | 200 |

The reference project's public GitHub provider uses `electron-updater` 6.8.9: it reads the Atom feed first, the
preview channel picks a published tag,
the stable channel uses GitHub's public `releases/latest`, and then the metadata for that tag is fetched. Only the
entry points and behavior are referenced; no code was copied.
Upstream source: [GitHubProvider.ts](https://github.com/electron-userland/electron-builder/blob/master/packages/electron-updater/src/providers/GitHubProvider.ts).
The master content may change; the version and entry points above are code-reading evidence from the dependency
actually installed locally.

## Adoption and limits

- Work Fleet on all three platforms now reads the Atom feed, and picks the highest version in the feed by the
  same-repo alternate link and `<platform>-vX.Y.Z`.
  Versions are not ordered by publication date; manifest/appcast/installer URLs are built from the configured repo and
  the verified tag.
- The public Atom feed contains only published releases, but has no reliable prerelease field. The current preview
  includes prereleases; other channels are explicitly rejected,
  and a stable channel cannot use the same logic directly. `releases/latest` spans platforms and excludes previews,
  so it cannot replace this product's tag filtering.
- The Atom feed is a limited list of recent entries. When a non-empty feed has nothing for this platform, the app
  cannot answer that it is up to date; it shows that the source is insufficient, and a long-term per-platform index is
  a separate decision.
- No old release needs updating and no new index needs publishing; the existing tags'
  `work-fleet-update.json`/`appcast.xml` stay readable.
  The Atom feed has no asset size, so the manifest's expected values are used instead to check the real downloaded
  bytes, SHA-256 and the existing package identity/signature.
- GitHub's public pages may still refuse requests; only 429 or a 403 with Retry-After is labeled rate limiting in this
  flow, and an ordinary 403 is labeled a refusal by the source.
  Removing the 60-per-hour API dependency is not a claim that GitHub has no limits at all.
