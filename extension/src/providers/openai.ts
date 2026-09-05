// OpenAI organization costs provider (provider-framework spec §OpenAI
// Parsing; spike evidence in docs/spike/endpoints.md).
//
// Endpoint: GET /v1/organization/costs. Total = sum of results[].amount.value;
// rows bucket by line_item (model, usage_type) and the bucketed totals are
// exposed as the usage breakdown. Cursor pagination: the response carries
// `next_page` and fetching continues until it is absent/null — the cursor and
// fold totals live in PageParse.state (AD-2, opaque to the engine).
//
// Request constraints modeled BEFORE dispatch (spec §OpenAI Request
// Validation): start_time required, bucket_width fixed at 1d. The admin key
// with read scope is declared via the credentialType.
import type { PageParse, Provider, ProviderState, UsageQuery } from '../core/provider';
import type { LineItem } from '../core/usage';
import type { ProviderRequest } from '../network/request';
import { asFiniteNumber, asObject } from './parse-utils';

const COSTS_URL = 'https://api.openai.com/v1/organization/costs';
/** Fixed for this use case per the documented constraints; any other value is rejected. */
const BUCKET_WIDTH = '1d';

/** Request parameters for one costs page; `page` carries the `next_page` cursor. */
export interface CostsRequestParams {
  readonly startTime?: number;
  readonly endTime?: number;
  readonly bucketWidth?: string;
  readonly page?: string;
}

/**
 * Builds and validates a costs request BEFORE dispatch: start_time is
 * required and bucket_width must be 1d (spec §OpenAI Request Validation).
 */
export function buildCostsRequest(params: CostsRequestParams): ProviderRequest {
  if (params.startTime === undefined) {
    throw new Error('OpenAI costs request requires start_time (epoch seconds).');
  }
  if (params.bucketWidth !== undefined && params.bucketWidth !== BUCKET_WIDTH) {
    throw new Error(`OpenAI costs request must fix bucket_width at 1d, got ${params.bucketWidth}.`);
  }
  const query: Record<string, string | number> = {
    start_time: params.startTime,
    bucket_width: BUCKET_WIDTH,
  };
  if (params.endTime !== undefined) {
    query.end_time = params.endTime;
  }
  if (params.page !== undefined) {
    query.page = params.page;
  }
  return { method: 'GET', url: COSTS_URL, query };
}

/** Fold state threaded across cursor pages by the engine (AD-2: opaque to it). */
type OpenAiFold = {
  readonly sum: number;
  readonly buckets: readonly LineItem[];
  readonly currency: string;
};

/** Internal mutable line item — copied per page so buckets accumulate in place. */
type MutableLineItem = { model: string; usageType: string; value: number };

export class OpenAiProvider implements Provider {
  readonly id = 'openai' as const;
  readonly displayName = 'OpenAI';
  readonly credentialType = 'openai-admin-read' as const;
  // No interPageDelayMs: the costs endpoint documents no politeness window.

  /**
   * Query window of the current refresh cycle, set by firstRequest and read
   * when rebuilding cursor requests. Holds no pagination state itself — the
   * engine refreshes providers sequentially, one cycle per instance.
   */
  private cycleStart: number | undefined;
  private cycleEnd: number | undefined;

  firstRequest(query: UsageQuery): ProviderRequest {
    const request = buildCostsRequest({ startTime: query.startTime, endTime: query.endTime });
    this.cycleStart = query.startTime;
    this.cycleEnd = query.endTime;
    return request;
  }

  parsePage(body: unknown, state: ProviderState | null): PageParse {
    const root = asObject(body);
    const results = root?.results;
    if (!Array.isArray(results)) {
      throw new Error('OpenAI costs response is missing results[].');
    }

    const prior = state as OpenAiFold | null;
    let sum = prior?.sum ?? 0;
    let currency = prior?.currency ?? '';
    const buckets: MutableLineItem[] = (prior?.buckets ?? []).map((bucket) => ({ ...bucket }));

    for (const entry of results) {
      const row = asObject(entry);
      const amount = asObject(row?.amount);
      const value = asFiniteNumber(amount?.value);
      if (row === null || amount === null || value === null) {
        throw new Error('OpenAI costs row is missing amount.value.');
      }
      const lineItem = asObject(row.line_item);
      const model = lineItem?.model;
      const usageType = lineItem?.usage_type;
      if (typeof model !== 'string' || typeof usageType !== 'string') {
        throw new Error('OpenAI costs row is missing line_item (model, usage_type).');
      }
      if (typeof amount.currency === 'string' && amount.currency.length > 0) {
        currency = amount.currency;
      }
      sum += value;
      const bucket = buckets.find((b) => b.model === model && b.usageType === usageType);
      if (bucket === undefined) {
        buckets.push({ model, usageType, value });
      } else {
        bucket.value += value;
      }
    }

    const fold: OpenAiFold = { sum, buckets, currency };
    const nextPage = root?.next_page;
    if (typeof nextPage === 'string' && nextPage.length > 0) {
      if (this.cycleStart === undefined) {
        throw new Error('OpenAI: firstRequest must run before parsePage.');
      }
      return {
        done: false,
        state: fold,
        next: buildCostsRequest({
          startTime: this.cycleStart,
          endTime: this.cycleEnd,
          page: nextPage,
        }),
      };
    }
    return {
      done: true,
      usage: {
        providerId: 'openai',
        kind: 'cost',
        value: fold.sum,
        currency: fold.currency,
        breakdown: fold.buckets,
        // Placeholder: the refresh engine stamps the fold time from the injected Clock (AD-1).
        fetchedAt: 0,
      },
    };
  }
}
