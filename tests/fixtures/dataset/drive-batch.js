/** Synthetic results using the leading CRLF observed in Drive's real multipart response. */
export function driveBatchResponse(statuses, { boundary = 'batch_fixture', preamble = '\r\n', epilogue = '', padding = '' } = {}) {
  const body = preamble + statuses.map(([index, status]) => `--${boundary}${padding}\r\nContent-Type: application/http\r\nContent-ID: <response-wf-${index}>\r\n\r\nHTTP/1.1 ${status} Result\r\nContent-Type: application/json\r\n\r\n${status === 403 ? '{"error":{"errors":[{"reason":"rateLimitExceeded"}]}}' : ''}\r\n`).join('')
    + `--${boundary}--${padding}\r\n${epilogue}`;
  return new TextEncoder().encode(body);
}
