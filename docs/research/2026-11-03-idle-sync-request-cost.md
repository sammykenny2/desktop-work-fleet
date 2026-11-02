# Idle Google sync: request cost and evidence limits

Date: 2026-11-03. Evidence for proposed
[ADR-063](../decisions/063-efficient-idle-sync.md),
[SPEC-011](../specs/011-efficient-idle-sync.md) and
[PLAN-012](../plans/012-efficient-idle-sync.md).

## Observed production-JS behavior with a fixture provider

At source `34d66f228e7ba574ca8ad5b699b0f9ef7758db05`, run production `Workspace`,
`WorkspaceRecordStorage` and `DatasetSync` against `MemoryRecordStore` and
`tests/fixtures/dataset/provider.js`'s `DatasetTestProvider`. Create a current-format
`google:test` workspace with `bootstrapGroup: false`, complete one initialization sync,
then count provider method calls in three further sync rounds without making changes.
Wrap provider methods in a counting Proxy and invoke methods with the original provider
as `this`; classify object reads by file kind and list calls by query scope.

Each of the three rounds had zero notes, zero pending operations and the same result:

| Provider operation | Calls per unchanged round |
|---|---:|
| `getObject`: dataset root / descriptor / ready receipt | 5 each |
| `listObjects`: fences / datasets | 5 each |
| `readObject`: descriptor / ready receipt | 5 each |
| `listDatasetChanges` | 2 |
| **Total** | **37** |

This executed the production sync algorithm, but used an in-memory provider. It is
neither an authenticated Drive trace nor a measurement of the user's network latency.
The same construction is available in `tests/dataset-sync.test.js`'s client fixture;
the new plan calls for a committed automated cost assertion before optimization.

## Cost derived from the source

- `src/sources/dataset-sync.js` validates a known generation at entry, then before and
  after each warm pull. It performs a second pull even when the upload page is empty:
  five generation validations and two feed reads. Warm pulls also reload 17 local view
  controls and call `receiveDataset`, even if no remote event changed a shard.
- `DatasetProtocol.assertGeneration` uses three metadata reads, two listings and two
  immutable JSON reads. Each Apple JSON read includes a metadata request and a media
  request in `FleetDrive.swift`: the 37 provider calls therefore imply **at least 47
  Drive HTTP requests** in the simple single-page case. When root-parent verification
  in `src/native/google.js` needs a filtered roots listing, five more calls give **52**.
  Paging, retries and token refresh can add more. These are source-derived counts,
  not observed HTTP counts from the maintainer's account.
- `src/native/apple/Shared/BoundedHTTP.swift` creates an ephemeral URLSession per send
  and invalidates it at completion. Sessions cannot reuse each other's connection pool;
  a timing improvement is plausible but must be measured on the real native path.
- `src/app/main.js` starts a nominal 20-second interval and sets the visible busy state
  for each `syncGoogle` attempt. Expensive idle requests therefore become recurring
  visible "Syncing" time, regardless of whether any note changed.
- Existing `sync.cursor`, `sync.datasetView`, `sync.lastSuccessfulSyncAt` and the
  record store's guarded transaction already represent the state needed by an empty
  check. A narrow mutation method can change behavior without changing those formats.

## Primary-source checks

Sources checked on 2026-11-03; interpretations below inform the proposal, not completed
implementation or proof of all provider behaviors.

- Google recommends the changes collection for efficient change detection and explains
  storing a start token and continuing through change pages.
  [Retrieve changes](https://developers.google.com/workspace/drive/api/guides/manage-changes).
- The API supports `spaces=appDataFolder` and `includeRemoved`; restricting to My Drive
  excludes app data. A terminal `newStartPageToken` and an intermediate `nextPageToken`
  have different roles. The current reference says change page tokens do not expire;
  retain defensive handling of rejected tokens without treating periodic expiry as
  normal or confusing these tokens with `files.list` pagination.
  [changes.list reference](https://developers.google.com/workspace/drive/api/reference/rest/v3/changes/list).
- Apple explains that a URLSession owns its connection pool and recommends fewer
  session instances to benefit from connection reuse.
  [WWDC 2018: Optimizing Your App for Today's Internet](https://developer.apple.com/videos/play/wwdc2018/714/).
- Drive push needs an HTTPS notification receiver; a notification still requires a
  changes read. That adds a service dependency rather than removing the need for an
  efficient desktop/mobile read path.
  [Push notifications](https://developers.google.com/workspace/drive/api/guides/push).

## Implementation evidence and transport audit

The shared idle regression now observes one provider feed call, zero local record reads
and two payload-row writes. The due audit observes eight provider calls. The history
fixture is lazy, as in the baseline; this is not an authenticated HTTP timing result.

| Host | Transport evidence and implementation |
|---|---|
| macOS / iOS | FleetDrive now owns one BoundedHTTPSession per account context. The macOS loopback probe observes reused URLSession transactions and exercises response bounds, cancellation, redirects and parallel tasks. Both app targets build. This is not evidence of live Google reuse on iOS. |
| Linux | The previous helper used urllib for every request. Python explicitly documents its `Connection: close` behavior. Drive now retains drained direct HTTPS connections with request-local headers; OAuth/avatar requests keep their original helper. A configured HTTPS proxy retains the urllib path, so proxy routing is never silently bypassed. Loopback checks confirm reuse and isolation; real Linux/Google timing remains unverified. |
| Windows | NativeGoogle owns one HttpClient and lifetime cancellation source, disposing both at context retirement. No per-request client replacement was found; no networking change was made. |
| Android | GoogleFiles creates one HttpURLConnection wrapper per request, drains/closes the bounded stream and calls disconnect. Android documents that disconnect can return the underlying socket to its pool. This is not the Apple session-lifetime defect, and no transport rewrite was justified. Actual device/server reuse still needs measurement. |

Primary sources for the additional audit:
[Python urllib.request](https://docs.python.org/3/library/urllib.request.html),
[Python http.client](https://docs.python.org/3/library/http.client.html),
[Android HttpURLConnection](https://developer.android.com/reference/java/net/HttpURLConnection).

The Apple Debug `--drive-read-probe` route uses FleetGoogle and FleetDrive before
loading the renderer. It compares per-request sessions with the account session using
the same fixed read-only feed, and emits only aggregate counts, times and connection
metrics. It is a native transport measurement, not a complete sync round or control-event
test. See [the procedure](../testing.md#idle-sync-verification).

## Unverified boundaries

No authenticated per-request timing, live Google connection-reuse measurement or real
multi-device control-event experiment has been captured for this change. The maintainer
reported that reset completed and synchronization now succeeds; that observation does
not establish these performance properties. Transport inspection and isolated checks
above do not establish authenticated timing or native UI acceptance on those hosts.

The proposed audit interval and one-request fast path are design choices. The primary
sources do not promise a visibility deadline, atomic snapshot across separate requests,
or a universal one-second round trip. Acceptance requires the concrete measurements
and failure cases in SPEC-011, not another release used as a substitute for diagnosis.
