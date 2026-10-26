// DeepSeek (api.deepseek.com) pay-as-you-go wallet provider (hito-13 WU-A;
// live capture 2026-10-25, spike evidence in docs/spike/endpoints.md).
//
// Endpoint: GET /user/balance with a Bearer key. DeepSeek exposes no
// usage-history endpoint — the balance is the only account surface, and ALL
// its monetary figures are decimal STRINGS (`total_balance` remaining,
// `granted_balance` not-expired gifts, `topped_up_balance`) denominated per
// `balance_infos` entry (CNY or USD). Consumption is therefore DERIVED: the
// wallet total is topped_up + granted, consumed is total - total_balance,
// and the percentage rides the derived wallet (see core/usage.ts
// `WalletUsage`). Only the FIRST balance_infos entry is parsed.
// `is_available: false` is a STATE, not an error — the figures still render.
import type { PageParse, Provider, ProviderState, UsageQuery } from '../core/provider';
import type { WalletUsage } from '../core/usage';
import type { ProviderRequest } from '../network/request';
import { asFiniteNumber, asObject } from './parse-utils';

const BALANCE_URL = 'https://api.deepseek.com/user/balance';

export class DeepSeekProvider implements Provider {
  readonly id = 'deepseek' as const;
  readonly displayName = 'DeepSeek';
  readonly credentialType = 'bearer' as const;

  firstRequest(_query: UsageQuery): ProviderRequest {
    return { method: 'GET', url: BALANCE_URL };
  }

  parsePage(body: unknown, _state: ProviderState | null): PageParse {
    const root = asObject(body);
    const infos = root?.balance_infos;
    const entry = Array.isArray(infos) ? asObject(infos[0]) : null;
    const value = entry === null ? null : asFiniteNumber(entry.total_balance);
    if (entry === null || value === null) {
      throw new Error('DeepSeek user/balance response is missing balance_infos[0].total_balance.');
    }
    if (typeof entry.currency !== 'string') {
      throw new Error('DeepSeek user/balance response is missing balance_infos[0].currency.');
    }
    const currency = entry.currency;
    // Tolerant parse: absent granted/topped_up fields count as 0. `consumed`
    // stays passthrough (never clamped) — expired grants land here too.
    const granted = asFiniteNumber(entry.granted_balance) ?? 0;
    const toppedUp = asFiniteNumber(entry.topped_up_balance) ?? 0;
    const total = toppedUp + granted;
    const wallet: WalletUsage = {
      currency,
      total,
      consumed: total - value,
      // Honest absence: a zero total has no meaningful share — omit, never NaN.
      ...(total === 0 ? {} : { percentage: ((total - value) / total) * 100 }),
    };
    return {
      done: true,
      usage: {
        providerId: 'deepseek',
        kind: 'balance',
        value,
        currency,
        wallet,
        // Placeholder: the refresh engine stamps the fold time from the injected Clock (AD-1).
        fetchedAt: 0,
      },
    };
  }
}
