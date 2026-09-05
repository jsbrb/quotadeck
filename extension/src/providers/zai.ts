// ZAI (Zhipu AI, bigmodel.cn) expenseBillList provider (provider-framework
// spec §ZAI Parsing; spike evidence in docs/spike/endpoints.md).
//
// Endpoint: GET /api/finance/expenseBill/expenseBillList with billingMonth
// (YYYY-MM) plus pageNum/pageSize. Success is a NUMERIC `code` 200 only —
// some deployments emit `code` as a string, and a string "200" is a failure.
// Cost per record = costPrice / 1000 * deductUsage; the tier label comes
// from tokenResourceName (last write wins — the API exposes no tier
// aggregation, and no tier limits at all); records are deduplicated by
// billingNo across pages.
//
// Pagination state (dedupe set + running totals) lives in PageParse.state
// and is opaque to the engine (AD-2); the engine draws the declared
// [500, 2000] ms inter-page delay from the injected Clock.
import type { PageParse, Provider, ProviderState, UsageQuery } from '../core/provider';
import type { ProviderRequest } from '../network/request';
import { asObject } from './parse-utils';

const EXPENSE_BILL_LIST_URL = 'https://bigmodel.cn/api/finance/expenseBill/expenseBillList';
/** Page size matching the recorded fixtures (3 pages x 2 records, total 5). */
const PAGE_SIZE = 2;
const BILLING_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Fold state threaded across pages by the engine (AD-2: opaque to it). */
type ZaiFold = {
  /** billingNos already counted — repeats across pages count once (spec). */
  readonly seen: readonly string[];
  /** Running sum of costPrice / 1000 * deductUsage over deduplicated records. */
  readonly cost: number;
  /** tokenResourceName of the most recent record — deterministic label. */
  readonly tier: string;
  readonly currency: string;
};

export class ZaiProvider implements Provider {
  readonly id = 'zai' as const;
  readonly displayName = 'ZAI (Zhipu AI)';
  readonly credentialType = 'bearer' as const;
  /** Community-documented politeness window between consecutive pages. */
  readonly interPageDelayMs = [500, 2000] as const;

  /**
   * Billing month of the current refresh cycle, set by firstRequest and read
   * when rebuilding the next page request. Holds no pagination state itself —
   * the engine refreshes providers sequentially, one cycle per instance.
   */
  private cycleMonth: string | undefined;

  firstRequest(query: UsageQuery): ProviderRequest {
    const month = query.billingMonth;
    if (month === undefined || !BILLING_MONTH_PATTERN.test(month)) {
      throw new Error('ZAI requires a billingMonth in YYYY-MM format.');
    }
    this.cycleMonth = month;
    return {
      method: 'GET',
      url: EXPENSE_BILL_LIST_URL,
      query: { billingMonth: month, pageNum: 1, pageSize: PAGE_SIZE },
    };
  }

  parsePage(body: unknown, state: ProviderState | null): PageParse {
    const root = asObject(body);
    const code = root?.code;
    if (root === null || typeof code !== 'number' || code !== 200) {
      throw new Error(
        `ZAI expenseBillList failed: success requires numeric code 200, got ${code === undefined ? 'no code' : `${typeof code} ${JSON.stringify(code)}`}.`,
      );
    }
    if (this.cycleMonth === undefined) {
      throw new Error('ZAI: firstRequest must run before parsePage.');
    }
    const data = asObject(root.data);
    const list = data?.list;
    if (!Array.isArray(list) || list.length === 0) {
      throw new Error('ZAI expenseBillList page carries no records before total was reached.');
    }
    const total = data?.total;
    const pageNum = data?.pageNum;
    if (typeof total !== 'number' || typeof pageNum !== 'number') {
      throw new Error('ZAI expenseBillList page is missing numeric data.total/data.pageNum.');
    }

    const prior = state as ZaiFold | null;
    const seen = new Set(prior?.seen ?? []);
    let cost = prior?.cost ?? 0;
    let tier = prior?.tier ?? '';
    let currency = prior?.currency ?? 'CNY';

    for (const entry of list) {
      const record = asObject(entry);
      const billingNo = record?.billingNo;
      const costPrice = record?.costPrice;
      const deductUsage = record?.deductUsage;
      if (
        record === null ||
        typeof billingNo !== 'string' ||
        typeof costPrice !== 'number' ||
        typeof deductUsage !== 'number'
      ) {
        throw new Error('ZAI expense bill record is missing billingNo/costPrice/deductUsage.');
      }
      if (seen.has(billingNo)) {
        continue; // repeated billingNo counts once (spec)
      }
      cost += (costPrice / 1000) * deductUsage;
      if (typeof record.tokenResourceName === 'string' && record.tokenResourceName.length > 0) {
        tier = record.tokenResourceName;
      }
      if (typeof record.currency === 'string' && record.currency.length > 0) {
        currency = record.currency;
      }
      seen.add(billingNo);
    }

    const fold: ZaiFold = { seen: [...seen], cost, tier, currency };
    if (seen.size >= total) {
      return {
        done: true,
        usage: {
          providerId: 'zai',
          kind: 'cost',
          value: fold.cost,
          currency: fold.currency,
          tier: fold.tier,
          // Placeholder: the refresh engine stamps the fold time from the injected Clock (AD-1).
          fetchedAt: 0,
        },
      };
    }
    return {
      done: false,
      state: fold,
      next: {
        method: 'GET',
        url: EXPENSE_BILL_LIST_URL,
        query: { billingMonth: this.cycleMonth, pageNum: pageNum + 1, pageSize: PAGE_SIZE },
      },
    };
  }
}
