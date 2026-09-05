// Transport double: queues scripted responses, records every admitted request.
//
// Used by network-layer tests to prove (a) which requests actually reached the
// transport and (b) that rejected requests cause ZERO transport I/O. A fetch
// with an empty queue throws, so an unexpected dispatch fails loudly instead of
// silently returning undefined.
import type { AuthorizedRequest, Transport, TransportResponse } from '../network/transport';

export class RecordingTransport implements Transport {
  readonly requests: AuthorizedRequest[] = [];

  constructor(private readonly queue: TransportResponse[] = []) {}

  async fetch(request: AuthorizedRequest): Promise<TransportResponse> {
    this.requests.push(request);
    const next = this.queue.shift();
    if (next === undefined) {
      throw new Error(`RecordingTransport: unexpected fetch — no queued response for ${request.url}`);
    }
    return next;
  }
}
