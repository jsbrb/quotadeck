// ZAI (Zhipu AI, bigmodel.cn) expenseBillList provider — window semantics
// (provider-framework spec §ZAI Parsing; tier-budget spec; AD-23; spike
// evidence in docs/spike/endpoints.md).
//
// Endpoint: GET /api/finance/expenseBill/expenseBillList with billingMonth
// (YYYY-MM) plus pageNum/pageSize. Success is a NUMERIC `code` 200 only —
// some deployments emit `code` as a string, and a string "200" is a failure
// (ProviderApiError; classifies as `server` per AD-21).
//
// Window semantics (AD-23): the refresh walks every `billingMonths` entry
// oldest-first through the same opaque pagination state the engine already
// threads (AD-2) — a month is done when its `total` is reached, then the
// queue's next month starts at pageNum 1. Per record: cost stays
// informational (Σ costPrice/1000 × deductUsage over deduped billingNos,
// all months), while `apiUsage` extracts fold into the tier budget via
// core/tier-budget — transaction_time is the 13 epoch-ms digits after the
// first `data.customerId` occurrence inside `billingNo`; the tier is the
// latest in-window `tokenResourceName`; the countdown is the latest
// in-window record's `timeWindow` end (after the `~` split, fixed +08:00).
// Records with unextractable epochs are excluded from the budget
// deterministically — cost still reports (spec §Unextractable record excluded).
import { ProviderApiError, type PageParse, type Provider, type ProviderState, type UsageQuery } from '../core/provider';
import { cstEpoch, epochFromBillingNo, evaluateBudget, type BudgetRecord } from '../core/tier-budget';
import type { ProviderRequest } from '../network/request';
import { asObject } from './parse-utils';

const EXPENSE_BILL_LIST_URL = 'https://bigmodel.cn/api/finance/expenseBill/expenseBillList';
/** Page size matching the recorded fixtures (3 pages x 2 records, total 5). */
const PAGE_SIZE = 2;
const BILLING_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
/** `timeWindow` end wall time (`YYYY-MM-DD HH:mm:ss`) in the fixed +08:00 zone. */
const TIME_WINDOW_END_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/;

/** Fold state threaded across pages by the engine (AD-2: opaque to it). */
type ZaiFold = {
  /** Months not yet walked, oldest first — the queue lives HERE (AD-23). */
  readonly monthsQueue: readonly string[];
  /** Month currently being paginated. */
  readonly month: string;
  /** billingNos already counted this month — repeats across pages count once (spec). */
  readonly seen: readonly string[];
  /** Per-record budget extracts accumulated across all months. */
  readonly records: readonly BudgetRecord[];
  /** Running informational cost: Σ costPrice / 1000 * deductUsage, deduped. */
  readonly cost: number;
  readonly currency: string;
};

/** Cycle context set by firstRequest, seeding the fold on the first page. */
interface CycleContext {
  readonly months: readonly string[];
  readonly now: number;
  readonly tierLimits: Readonly<Record<string, number>>;
}

/**
 * timeWindow end as epoch ms: the part after the `~` separator, parsed in the
 * AD-20 fixed +08:00 zone. Anything unparseable yields `undefined` — the
 * countdown is gracefully absent, never an error.
 */
function parseTimeWindowEnd(value: unknown): number | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const parts = value.split('~');
  if (parts.length !== 2) {
    return undefined;
  }
  const match = TIME_WINDOW_END_PATTERN.exec(parts[1]!.trim());
  if (match === null) {
    return undefined;
  }
  return cstEpoch(
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  );
}

export class ZaiProvider implements Provider {
  readonly id = 'zai' as const;
  readonly displayName = 'ZAI (Zhipu AI)';
  readonly credentialType = 'bearer' as const;
  /** Community-documented politeness window between consecutive pages. */
  readonly interPageDelayMs = [500, 2000] as const;

  /**
   * Query context of the current refresh cycle, set by firstRequest and read
   * only to seed the fold on the first page. Holds no pagination progress —
   * the months queue and cursor live in the opaque state; the engine
   * refreshes providers sequentially, one cycle per instance.
   */
  private cycle: CycleContext | undefined;

  firstRequest(query: UsageQuery): ProviderRequest {
    const months = query.billingMonths;
    if (
      months === undefined ||
      months.length === 0 ||
      months.some((month) => typeof month !== 'string' || !BILLING_MONTH_PATTERN.test(month))
    ) {
      throw new Error('ZAI requires billingMonths as a non-empty array of YYYY-MM values, oldest first.');
    }
    const now = query.now;
    if (typeof now !== 'number' || !Number.isFinite(now)) {
      throw new Error('ZAI requires a finite now (epoch ms) to anchor the 5h window.');
    }
    this.cycle = { months, now, tierLimits: query.tierLimits ?? {} };
    return {
      method: 'GET',
      url: EXPENSE_BILL_LIST_URL,
      query: { billingMonth: months[0], pageNum: 1, pageSize: PAGE_SIZE },
    };
  }

  parsePage(body: unknown, state: ProviderState | null): PageParse {
    const root = asObject(body);
    const code = root?.code;
    if (root === null || typeof code !== 'number' || code !== 200) {
      throw new ProviderApiError(
        `ZAI expenseBillList failed: success requires numeric code 200, got ${code === undefined ? 'no code' : `${typeof code} ${JSON.stringify(code)}`}.`,
      );
    }
    if (this.cycle === undefined) {
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
    const month = prior?.month ?? this.cycle.months[0];
    const monthsQueue = prior?.monthsQueue ?? this.cycle.months.slice(1);
    const seen = new Set(prior?.seen ?? []);
    let cost = prior?.cost ?? 0;
    let currency = prior?.currency ?? 'CNY';
    const records: BudgetRecord[] = [...(prior?.records ?? [])];
    // O3: customerId is pinned from community evidence at data.customerId;
    // absent → every epoch is unextractable → budget fields gracefully absent.
    const customerId =
      typeof data?.customerId === 'string' && data.customerId.length > 0 ? data.customerId : undefined;

    for (const entry of list) {
      const record = asObject(entry);
      const billingNo = record?.billingNo;
      const apiUsage = record?.apiUsage;
      const costPrice = record?.costPrice;
      const deductUsage = record?.deductUsage;
      if (
        record === null ||
        typeof billingNo !== 'string' ||
        typeof apiUsage !== 'number' ||
        !Number.isFinite(apiUsage) ||
        typeof costPrice !== 'number' ||
        typeof deductUsage !== 'number'
      ) {
        throw new Error('ZAI expense bill record is missing billingNo/apiUsage/costPrice/deductUsage.');
      }
      if (seen.has(billingNo)) {
        continue; // repeated billingNo counts once (spec)
      }
      cost += (costPrice / 1000) * deductUsage; // informational — never window-filtered
      const tokenResourceName =
        typeof record.tokenResourceName === 'string' && record.tokenResourceName.length > 0
          ? record.tokenResourceName
          : undefined;
      const timeWindowEnd = parseTimeWindowEnd(record.timeWindow);
      records.push({
        apiUsage,
        epochMs: epochFromBillingNo(billingNo, customerId),
        ...(tokenResourceName !== undefined ? { tokenResourceName } : {}),
        ...(timeWindowEnd !== undefined ? { timeWindowEnd } : {}),
      });
      if (typeof record.currency === 'string' && record.currency.length > 0) {
        currency = record.currency;
      }
      seen.add(billingNo);
    }

    if (seen.size >= total) {
      const [nextMonth, ...rest] = monthsQueue;
      if (nextMonth === undefined) {
        // Final fold: cost stays informational; the budget is the window view.
        const budget = evaluateBudget(records, { now: this.cycle.now, tierLimits: this.cycle.tierLimits });
        return {
          done: true,
          usage: {
            providerId: 'zai',
            kind: 'cost',
            value: cost,
            currency,
            ...(budget.tier !== undefined ? { tier: budget.tier } : {}),
            budget,
            // Placeholder: the refresh engine stamps the fold time from the injected Clock (AD-1).
            fetchedAt: 0,
          },
        };
      }
      const fold: ZaiFold = { monthsQueue: rest, month: nextMonth, seen: [], records, cost, currency };
      return {
        done: false,
        state: fold,
        next: {
          method: 'GET',
          url: EXPENSE_BILL_LIST_URL,
          query: { billingMonth: nextMonth, pageNum: 1, pageSize: PAGE_SIZE },
        },
      };
    }
    const fold: ZaiFold = { monthsQueue, month, seen: [...seen], records, cost, currency };
    return {
      done: false,
      state: fold,
      next: {
        method: 'GET',
        url: EXPENSE_BILL_LIST_URL,
        query: { billingMonth: month, pageNum: pageNum + 1, pageSize: PAGE_SIZE },
      },
    };
  }
}
