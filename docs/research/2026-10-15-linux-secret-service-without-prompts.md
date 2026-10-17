# Linux Secret Service behavior without unrequested prompts

Research date: 2026-10-15. The conclusions are used in
[ADR-048](../decisions/048-linux-offline-workspace-and-system-secrets.md); the tests use a private D-Bus and
synthetic data.

## Official evidence

- [Prompts and Prompting](https://specifications.freedesktop.org/secret-service/latest/prompts.html): an operation that
  needs interaction returns a prompt object, and the client then calls Prompt; so not running Prompt lets work that
  needs unlocking be paused. This is a behavior contract for clients, not a UI guarantee for every provider.
- [Collection CreateItem](https://specifications.freedesktop.org/secret-service/latest/org.freedesktop.Secret.Collection.html):
  CreateItem returns the item and prompt paths; replace only replaces the item in that collection with matching
  attributes.
- [Aliases](https://specifications.freedesktop.org/secret-service/latest/aliases.html): default/session are aliases
  and must be resolved to a collection object path.
  In the local GI, the value of `Secret.COLLECTION_SESSION` is the string `session`, which cannot be compared
  directly with an object path.
- [libsecret password_store_sync](https://gnome.pages.gitlab.gnome.org/libsecret/func.password_store_sync.html): the
  session collection is not kept across login sessions.
- [libsecret Service.open_sync](https://gnome.pages.gitlab.gnome.org/libsecret/type_func.Service.open_sync.html): a
  D-Bus service name can be specified, creating a new proxy. Synchronous methods may wait and should not run on the
  UI thread.
- [libsecret Collection.search_sync](https://gnome.pages.gitlab.gnome.org/libsecret/method.Collection.search_sync.html):
  the search can be limited to one collection, and only `UNLOCK` requests unlocking. This implementation searches only
  collections that are Locked=false at that moment, and does not use `LOAD_SECRETS`.
- [KeePassXC Service.cpp](https://raw.githubusercontent.com/keepassxreboot/keepassxc/develop/src/fdosecrets/objects/Service.cpp):
  with the `unlockBeforeSearch` setting, a global SearchItems can open an unlock dialog by itself, without going
  through Prompt.Prompt;
  so a Prompt monitor seeing no call alone does not imply that an arbitrary provider shows no UI. This implementation
  avoids global searches.

## Tests and inferences

- In a private gnome-keyring, an unlocked collection can save and read back through libsecret session encoding and a
  direct CreateItem.
  When the collection is locked after the precheck (a race), a failure is reported, and an independent dbus-monitor
  observed no `Prompt.Prompt`.
- After a provider restart, the old session should not be reused. GetNameOwner detects the new owner, the proxy is
  opened again, and synthetic secrets can be read and saved again;
  the probe does not reset the production Vault directly, and user data and the desktop bus take no part in the test.
- Releasing the proxy while the old libsecret service's collection callbacks had not finished once produced a GLib
  critical; after keeping the old proxy until the Vault ends,
  the same restart probe shows no warning. This is evidence from this Pi runtime, and does not mean every libsecret
  version has the same problem.
- Several collections can hold secrets with the same attributes at once. The canonical read uses a collection search
  of the persistent default;
  the first result of a global search cannot be assumed correct, and the item object path cannot be relied on to be
  nested under the collection.
- After the real probe switched to collection searches, the proxy's old Locked/secret cache once allowed reading the
  token from before locking.
  With a live Properties.Get Locked and a fresh GetSecret/session decode, the same lock test without a manual cache
  refresh passed.
  After the synthetic token is updated externally, the new value can also be read at once, without relying on the
  main loop to process cache notifications.

## Verification boundaries

Same-day addition about the manual operation:
[libsecret unlock_sync](https://gnome.pages.gitlab.gnome.org/libsecret/method.Service.unlock_sync.html)
may wait forever; the [SecretPrompt source](https://raw.githubusercontent.com/GNOME/libsecret/master/libsecret/secret-prompt.c)
shows that cancelling calls Dismiss, but its successful reply is still not enough to end the wait, which also needs
Completed. From this we infer that adding a cancellable timer alone cannot guarantee a bounded return with a faulty
provider. This project therefore uses the Secret Service Unlock/Prompt directly for an explicit manual sync:
it first subscribes to Completed on the fixed owner/path, then shows the system window; its own wait has a deadline,
and on timeout it finishes with a non-blocking Dismiss.
The 90-second deadline starts at host admission, and the queries before and after share one cancellable; after a
cancel or an account switch, results from the old source are not accepted.
A real GI probe with a private synthetic provider verifies cancel/accept/timeout/close, slow preflight/read-back, no
Prompt opened when a request times out in the queue,
and still returning when Dismiss succeeds but Completed is never emitted. It uses no real password or graphical
window, and does not amount to acceptance of a provider's real UI.

Verified with a synthetic gnome-keyring; KWallet/other Secret Service providers, a user reboot and real Google OAuth
are not fully accepted.
The Secret Service specification is a draft; this implementation uses the established CreateItem/Delete/alias/session
interfaces and does not claim full specification compatibility.
