import { describe, expect, it } from 'vitest';
import { FIXTURE_RESPONSES } from '../fixtures';
import { AllowlistNetworkClient } from '../network/client';
import { FakeClock } from '../testing/fake-clock';
import { driveRefresh } from '../testing/provider-refresh';
import { RecordingTransport } from '../testing/recording-transport';
import { buildCostsRequest, OpenAiProvider } from './openai';

const QUERY = { startTime: 1754006400, endTime: 1754179200 };

describe('OpenAiProvider — request validation before dispatch (spec §OpenAI)', () => {
  it('rejects a request missing start_time', () => {
    expect(() => new OpenAiProvider().firstRequest({})).toThrow(/start_time/);
    expect(() => buildCostsRequest({})).toThrow(/start_time/);
  });

  it('rejects a bucket_width other than 1d', () => {
    expect(() => buildCostsRequest({ startTime: 1, bucketWidth: '1h' })).toThrow(/bucket_width.*1d/);
  });

  it('always builds the documented request shape: start_time, bucket_width fixed at 1d, optional end_time', () => {
    expect(buildCostsRequest({ startTime: 1754006400 }).query).toEqual({
      start_time: 1754006400,
      bucket_width: '1d',
    });
    expect(buildCostsRequest(QUERY).query).toEqual({
      start_time: 1754006400,
      bucket_width: '1d',
      end_time: 1754179200,
    });
  });
});

describe('OpenAiProvider — parsing and cursor pagination (spec §OpenAI)', () => {
  function openAiTransport(): RecordingTransport {
    return new RecordingTransport([
      FIXTURE_RESPONSES['openai/costs--page-1'],
      FIXTURE_RESPONSES['openai/costs--page-2-final'],
    ]);
  }

  it('aggregates amount.value across pages with per-line-item bucket totals and currency', async () => {
    const clock = new FakeClock();
    const usage = await driveRefresh(
      new OpenAiProvider(),
      QUERY,
      new AllowlistNetworkClient(openAiTransport()),
      clock,
    );

    // 10.50 + 4.25 + 2.00 (page 1) + 3.25 (page 2) = 20.
    expect(usage.value).toBe(20);
    expect(usage.kind).toBe('cost');
    expect(usage.currency).toBe('usd');
    expect(usage.breakdown).toEqual([
      { model: 'gpt-5.3', usageType: 'input_tokens', value: 12.5 }, // two rows in one bucket: 10.50 + 2.00
      { model: 'gpt-5.3', usageType: 'output_tokens', value: 4.25 },
      { model: 'gpt-5-mini', usageType: 'input_tokens', value: 3.25 },
    ]);
  });

  it('consumes exactly two pages: page 2 follows the next_page cursor and terminates when it is absent', async () => {
    const clock = new FakeClock();
    const transport = openAiTransport();
    await driveRefresh(new OpenAiProvider(), QUERY, new AllowlistNetworkClient(transport), clock);

    expect(transport.requests).toHaveLength(2);
    expect(transport.requests[0]!.url).toBe(
      'https://api.openai.com/v1/organization/costs?start_time=1754006400&bucket_width=1d&end_time=1754179200',
    );
    expect(transport.requests[1]!.url).toBe(
      'https://api.openai.com/v1/organization/costs' +
        '?start_time=1754006400&bucket_width=1d&end_time=1754179200&page=costs_page2_cursor_9f3ab2c1',
    );
    // OpenAI declares no politeness window: the clock never sleeps.
    expect(clock.sleeps).toEqual([]);
  });

  it('throws an explicit error when results[] is missing', () => {
    const provider = new OpenAiProvider();
    provider.firstRequest(QUERY);
    expect(() => provider.parsePage({ object: 'list' }, null)).toThrow(/results\[\]/);
  });
});
