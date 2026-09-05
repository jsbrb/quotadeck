// Qwen (Alibaba Cloud BSS QueryAccountBalance) provider (provider-framework
// spec §Qwen Parsing; spike evidence in docs/spike/endpoints.md).
//
// Balance-only: value from Data.AvailableAmount, currency from Data.Currency
// (BSS serializes amounts as decimal strings — parsed numerically here).
// The credential type is Alibaba AK/SK; DashScope `sk-` keys are rejected by
// core/credentials through this declared type (spec §Qwen — DashScope key
// rejected). AK/SK request signing is a live-milestone concern handled
// behind the network seam.
import type { PageParse, Provider, ProviderState, UsageQuery } from '../core/provider';
import type { ProviderRequest } from '../network/request';
import { asFiniteNumber, asObject } from './parse-utils';

export class QwenProvider implements Provider {
  readonly id = 'qwen' as const;
  readonly displayName = 'Qwen (Alibaba Cloud BSS)';
  readonly credentialType = 'ak-sk' as const;

  firstRequest(_query: UsageQuery): ProviderRequest {
    // RPC-style BSS call: action and API version travel as query parameters.
    return {
      method: 'GET',
      url: 'https://business.aliyuncs.com/',
      query: { Action: 'QueryAccountBalance', Version: '2017-12-14' },
    };
  }

  parsePage(body: unknown, _state: ProviderState | null): PageParse {
    const data = asObject(asObject(body)?.Data);
    const value = asFiniteNumber(data?.AvailableAmount);
    const currency = data?.Currency;
    if (data === null || value === null) {
      throw new Error('Qwen QueryAccountBalance response is missing Data.AvailableAmount.');
    }
    if (typeof currency !== 'string' || currency.length === 0) {
      throw new Error('Qwen QueryAccountBalance response is missing Data.Currency.');
    }
    return {
      done: true,
      usage: {
        providerId: 'qwen',
        kind: 'balance',
        value,
        currency,
        // Placeholder: the refresh engine stamps the fold time from the injected Clock (AD-1).
        fetchedAt: 0,
      },
    };
  }
}
