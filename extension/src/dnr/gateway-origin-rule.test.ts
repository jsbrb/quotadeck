// DNR gateway-origin session rule tests (hito-12 WU-F) — pure shape pins for
// the builder behind the one session rule the worker installs at boot.
// Context: Alibaba's WAF answers gateway requests carrying the forbidden
// `Origin: chrome-extension://<id>` with a 302 to err.taobao.com BEFORE
// app-level auth is ever reached (live header-variant probe, 2026-10-25:
// chrome-extension Origin → 302 err.taobao; the console origin → 200
// BailianGateway.Login.NotLogined; Sec-Fetch-*/UA irrelevant), so the rule
// SETS the gateway request's Origin to the public console-origin constant.
// The rule carries ZERO credentials: this is explicitly NOT the DNR
// cookie-VALUE injection rejected in hito-9 exploration.md §Lane 1(c) — no
// secret may ever enter rule data (the Bearer rides exclusively through the
// client's session-marker seam, network/client.ts), and these tests assert
// that ban.
import { deepStrictEqual } from 'node:assert';
import { describe, expect, it } from 'vitest';
import {
  buildGatewayOriginSessionRule,
  GATEWAY_ORIGIN_RULE_ID,
  QWEN_GATEWAY_API_PATH,
  QWEN_GATEWAY_ORIGIN_HEADER,
  QWEN_GATEWAY_TRUSTED_ORIGIN,
  QWEN_GATEWAY_URL_FILTER,
} from './gateway-origin-rule';
import { QWEN_TOKEN_PLAN_GATEWAY_HOST } from '../providers/qwen-token-plan';

/** chrome.runtime.id stand-in — the builder receives the id, it never reads chrome. */
const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop';

describe('dnr/gateway-origin-rule — session rule builder (hito-12 WU-F)', () => {
  it('sets exactly one request header — origin — to the public console origin constant', () => {
    const rule = buildGatewayOriginSessionRule({ extensionId: EXTENSION_ID });

    expect(QWEN_GATEWAY_TRUSTED_ORIGIN).toBe('https://modelstudio.console.alibabacloud.com');
    expect(rule.id).toBe(GATEWAY_ORIGIN_RULE_ID);
    expect(rule.action.type).toBe('modifyHeaders');
    expect(rule.action.requestHeaders).toEqual([
      { header: QWEN_GATEWAY_ORIGIN_HEADER, operation: 'set', value: QWEN_GATEWAY_TRUSTED_ORIGIN },
    ]);
  });

  it('freezes the rule id at 1 — bumping it would orphan the browser-lifetime rule in long-lived sessions', () => {
    // Session rules survive SW restarts for the browser's LIFETIME (hito-12
    // WU-J): the idempotent install removes THIS id and re-adds in one call.
    // A different id would leave the old id-1 rule resident forever.
    expect(GATEWAY_ORIGIN_RULE_ID).toBe(1);
  });

  it('scopes the condition to the gateway host, the quota api path, xhr requests, and our own extension as initiator', () => {
    const rule = buildGatewayOriginSessionRule({ extensionId: EXTENSION_ID });

    expect(rule.condition.requestDomains).toEqual([QWEN_TOKEN_PLAN_GATEWAY_HOST]);
    expect(QWEN_GATEWAY_URL_FILTER).toBe(`${QWEN_TOKEN_PLAN_GATEWAY_HOST}${QWEN_GATEWAY_API_PATH}`);
    expect(rule.condition.urlFilter).toBe(QWEN_GATEWAY_URL_FILTER);
    expect(rule.condition.resourceTypes).toEqual(['xmlhttprequest']);
    expect(rule.condition.initiatorDomains).toEqual([EXTENSION_ID]); // never a global (non-initiator-scoped) rule
  });

  it('carries no credential material: origin-only header ops and no secret-shaped string anywhere in the payload', () => {
    const rule = buildGatewayOriginSessionRule({ extensionId: EXTENSION_ID });

    // the ONLY header operation is the origin set — cookie/authorization may
    // never appear (hito-9 §Lane 1(c): rule data is public constants only).
    expect(rule.action.requestHeaders.map((operation) => operation.header)).toEqual(['origin']);
    const serialized = JSON.stringify(rule).toLowerCase();
    for (const forbidden of ['cookie', 'authorization', 'bearer', 'ltai', 'sk-', 'cliaccesstoken', 'sess-']) {
      expect(serialized, `the rule payload must never contain ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('builder output is stable across re-install calls — the remove+add reinstall stays byte-identical', () => {
    const first = buildGatewayOriginSessionRule({ extensionId: EXTENSION_ID });
    const second = buildGatewayOriginSessionRule({ extensionId: EXTENSION_ID });

    deepStrictEqual(second, first);
  });

  it('only the initiator scope varies with the caller-supplied id — host, path and origin constant stay fixed', () => {
    const mine = buildGatewayOriginSessionRule({ extensionId: EXTENSION_ID });
    const other = buildGatewayOriginSessionRule({ extensionId: 'otherextensionid00000000000000000000' });

    expect(other.condition.initiatorDomains).toEqual(['otherextensionid00000000000000000000']);
    expect({ ...other.condition, initiatorDomains: mine.condition.initiatorDomains }).toEqual(mine.condition);
  });
});
