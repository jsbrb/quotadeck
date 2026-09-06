// Qwen (Alibaba Cloud BSS QueryAccountBalance) provider (provider-framework
// spec §Qwen Parsing; spike evidence in docs/spike/endpoints.md).
//
// Balance-only: value from Data.AvailableAmount, currency from Data.Currency.
// BSS serializes the envelope per site — china answers NUMERIC Code 200 and
// numeric amounts, international answers STRING Code "200", bool Success and
// decimal STRING amounts — so parsing is tolerant on both axes: amounts pass
// through asFiniteNumber (number or decimal string → number), and success
// validation accepts both envelope forms while an explicitly non-success
// envelope (Success false, or a Code other than 200 in either form) fails as
// a body-level error (ProviderApiError; classifies as `server` per AD-21).
//
// The base URL is SITE-SELECTED from query.qwenSite (absent → international,
// the default; china → business.aliyuncs.com); an invalid site value throws
// in firstRequest — BEFORE any dispatch. The credential type is Alibaba
// AK/SK; DashScope `sk-` keys are rejected by core/credentials through this
// declared type. AK/SK request signing is handled behind the network seam.
import { isQwenSite, qwenBssBaseUrl } from '../core/qwen-sites';
import { ProviderApiError, type PageParse, type Provider, type ProviderState, type UsageQuery } from '../core/provider';
import type { ProviderRequest } from '../network/request';
import { asFiniteNumber, asObject } from './parse-utils';

export class QwenProvider implements Provider {
  readonly id = 'qwen' as const;
  readonly displayName = 'Qwen (Alibaba Cloud BSS)';
  readonly credentialType = 'ak-sk' as const;

  firstRequest(query: UsageQuery): ProviderRequest {
    // Runtime discipline (mirror of zai.ts): the site reaches here through
    // storage reads, so an invalid stored value must fail HERE — before any
    // dispatch (spec §Invalid site value rejected).
    const site: unknown = query.qwenSite ?? 'international';
    if (!isQwenSite(site)) {
      throw new Error(`Qwen requires qwenSite 'international' | 'china', got ${JSON.stringify(site)}.`);
    }
    // RPC-style BSS call: action and API version travel as query parameters.
    return {
      method: 'GET',
      url: `${qwenBssBaseUrl(site)}/`,
      query: { Action: 'QueryAccountBalance', Version: '2017-12-14' },
    };
  }

  parsePage(body: unknown, _state: ProviderState | null): PageParse {
    // Tolerant envelope validation (spec §Qwen Parsing): success is numeric
    // Code 200 (china) OR string "200" (international); an explicitly
    // non-success envelope fails as a body-level error before Data parsing.
    const envelope = asObject(body);
    if (envelope?.Success === false) {
      throw new ProviderApiError('Qwen QueryAccountBalance failed: Success is false.');
    }
    const code = envelope?.Code;
    if (code !== undefined && code !== 200 && code !== '200') {
      throw new ProviderApiError(
        `Qwen QueryAccountBalance failed: Code must be 200 or "200", got ${typeof code} ${JSON.stringify(code)}.`,
      );
    }
    const data = asObject(envelope?.Data);
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
