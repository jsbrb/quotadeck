// Kimi (Moonshot AI, api.moonshot.cn) balance provider (provider-framework
// spec §Kimi Parsing; spike evidence in docs/spike/endpoints.md).
//
// Endpoint: GET /v1/users/me/balance with a Bearer token. Balance comes from
// data.available_balance and is denominated CNY; the documented composition
// is cash_balance + voucher_balance (the recorded fixture satisfies it:
// 77.76 + 11.12 = 88.88), but only the available total is reported.
import type { PageParse, Provider, ProviderState, UsageQuery } from '../core/provider';
import type { ProviderRequest } from '../network/request';
import { asFiniteNumber, asObject } from './parse-utils';

const BALANCE_URL = 'https://api.moonshot.cn/v1/users/me/balance';

export class KimiProvider implements Provider {
  readonly id = 'kimi' as const;
  readonly displayName = 'Kimi (Moonshot AI)';
  readonly credentialType = 'bearer' as const;

  firstRequest(_query: UsageQuery): ProviderRequest {
    return { method: 'GET', url: BALANCE_URL };
  }

  parsePage(body: unknown, _state: ProviderState | null): PageParse {
    const data = asObject(asObject(body)?.data);
    const value = asFiniteNumber(data?.available_balance);
    if (data === null || value === null) {
      throw new Error('Kimi users/me/balance response is missing data.available_balance.');
    }
    return {
      done: true,
      usage: {
        providerId: 'kimi',
        kind: 'balance',
        value,
        currency: 'CNY',
        // Placeholder: the refresh engine stamps the fold time from the injected Clock (AD-1).
        fetchedAt: 0,
      },
    };
  }
}
