# Drive batch response framing

Date: 2026-11-03. Scope: the reset batch parser, not account data or authenticated deletion acceptance.

## Evidence

A request to `https://www.googleapis.com/batch/drive/v3` wrapped one read-only
`GET /drive/v3/about?fields=kind` with `Content-ID: wf-0`. It carried no authorization, API key, cookie or user file
identifier. The outer response was HTTP 200 with `multipart/mixed`; its single inner response was HTTP 401, as
expected without credentials. The body started with CRLF before its first boundary line.

The [normalized fixture](../../tests/fixtures/dataset/drive-batch-response.json) preserves the returned body; only
the generated boundary is replaced. Passing those bytes to the previous production `deleteBatchResult` raised
`invalid-source-response` before reading the inner status. This reproduces the reported generic format/size error
without accessing or changing a user's Drive. It does not establish what an earlier authenticated deletion removed.

The previous tests generated a boundary at byte zero and the UI fixture returned already parsed result objects.
Neither exercised the real leading CRLF. The regression now runs that captured body through the production parser,
and the UI fixture returns framed bytes instead of bypassing parsing.

## Protocol and correction

Google documents a multipart response with a complete HTTP result for each request and a `response-` prefix on
the corresponding Content-ID. An outer 200 does not make the individual actions successful.
Source: [Drive batch requests](https://developers.google.com/workspace/drive/api/guides/performance#batch_requests),
consulted 2026-11-03.

MIME permits a preamble and epilogue, including a CRLF before the first delimiter, and transport whitespace on
delimiter lines. Delimiters are recognized at line boundaries, not wherever their text occurs in a body.
Source: [RFC 2046 section 5.1.1](https://www.rfc-editor.org/rfc/rfc2046#section-5.1.1), consulted 2026-11-03.

The parser follows that framing while retaining the bounded response size, closing delimiter, unique Content-ID,
result-count and per-part status checks. Only 204 and 404 acknowledge deletion. If a reply cannot be verified, the
durable reset retains its captured IDs; continuation may receive 404 for an action that already completed.
The behavior contract remains [SPEC-010](../specs/010-dataset-checkpoints-and-deletable-history.md).
