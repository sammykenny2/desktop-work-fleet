# Backup container and encryption basis

Reviewed: 2026-10-04. External evidence, design choices and test scope are kept apart; the adopted decision is in
ADR-013.

## External evidence

- [PKWARE ZIP APPNOTE](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT) defines local/central headers,
  CRC, size, data descriptors and UTF-8 paths. The descriptor signature is optional; this reader recognizes it by the
  actual boundaries, which avoids the ambiguity when a CRC happens to equal the signature. The ASCII path allowlist,
  the extra-field limits and rejecting ZIP64 are product choices.
- The [official fflate project](https://github.com/101arrowz/fflate) provides a browser ES module and a streaming ZIP
  writer under the MIT license. This work pins 0.8.3 and packages its LICENSE; no other product's code or data
  contract was copied.
- [WHATWG Compression Streams](https://compression.spec.whatwg.org/) requires deflate-raw to follow RFC1951:
  invalid blocks, an unfinished stream and extra bytes after the final block must fail. This reader uses the native
  stream and limits output bytes.
- [Node Web Streams](https://nodejs.org/api/webstreams.html#class-decompressionstream) records deflate-raw support
  since 21.2.0/20.12.0, so the Node >=22 floor does not need raising; the versions actually tested are in the git
  history.
- The [Safari 16.4 WebKit announcement](https://webkit.org/blog/13966/webkit-features-in-safari-16-4/) announces
  Compression Streams. That alone does not prove deflate-raw behavior in every target WKWebView; a capability check
  and device probes are still needed.
- The [Web Cryptography specification](https://www.w3.org/TR/webcrypto/) defines PBKDF2, AES-GCM and nonextractable
  CryptoKeys. The container uses standard operations and authenticated additional data, with no custom cipher.
- The [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
  lists a work factor of 600,000 for PBKDF2-HMAC-SHA256; that page generally prefers Argon2id.
  This product chooses PBKDF2 for WebCrypto portability and does not present the citation as OWASP certification of
  the format or as a FIPS compliance claim.
- The [Chrome File System Access guide](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)
  describes the secure context, user gesture, save picker, createWritable/write/close and getFile.
  Compressing first can lose transient activation, so the product asks for the file first and generates the bytes
  afterwards; reading back the hash after saving is this product's own additional integrity decision. The download
  fallback cannot confirm the save in the same way.

## What the experiments mean

The malicious ZIPs include a wrong NLEN, unfinished DEFLATE, trailing garbage after compressed data, BOM names and a
CRC/signature collision.
Errors that a lenient decompressor accepted are now rejected by the native DecompressionStream; large stored files get
a chunked CRC and yield to cancel events.
Python's standard-library zipfile also reads the output; independent two-way OpenSSL/WebCrypto tests check the KDF,
AAD and GCM tag.
This is container interoperability and error-handling evidence, not acceptance of Google, native file durability or
all five platforms.
A new Edge UI probe replaces only the picker; the actual writes/close/getFile use OPFS handles in an isolated profile.
It can verify API save/read-back and the UI gates; it does not support a claim that OS pickers, external disks or
power-loss durability have passed.

## Decisions and what remains to verify

[SPEC-002](../specs/002-portable-backup-and-restore.md) defines the complete format, the three restore modes and
automatic backups.
Limits such as 128 MiB expanded are engineering choices that prevent unbounded allocation; the capacity of the lowest
phones and of all five platforms still has to be measured.
Secure password storage, automatic scheduling/OS suspension, atomic file saving and restore transactions each need
their own failure acceptance.
Current status is in [PROGRESS](../../PROGRESS.md), with history and verification evidence in the git history and
[testing](../testing.md); this research does not imply that anything is implemented.
