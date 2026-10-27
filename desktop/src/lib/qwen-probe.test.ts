// Spike WU-U (qwen cookie-hop): the probe request must be a byte-exact twin
// of the extension's hop-2 usage request (qwen-token-plan.ts) MINUS the
// session marker — the whole point is asking the gateway for the SAME
// resource while authenticated ONLY by the console session cookies. The
// builders are pure so the shape is pinned without any network I/O.
import { describe, expect, it } from "vitest";
import { qwenUsageProbeBody, qwenUsageProbeUrl } from "./qwen-probe";

describe("qwen cookie probe request builders", () => {
  it("builds the live-verified usage URL with the query trio encoded", () => {
    const url = qwenUsageProbeUrl();
    expect(url.startsWith("https://bailian-singapore-cs.alibabacloud.com/cli/api.json?")).toBe(true);
    expect(url).toContain("action=IntlBroadScopeAspnGateway");
    expect(url).toContain("product=sfm_bailian");
    // The live capture showed the api path percent-encoded in the query.
    expect(url).toContain(
      `api=${encodeURIComponent("zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/usage")}`,
    );
  });

  it("builds the static form body — switchAgent omitted entirely", () => {
    const body = qwenUsageProbeBody();
    expect(body.startsWith("params={")).toBe(true);
    expect(body.endsWith("&region=ap-southeast-1")).toBe(true);
    // No account identifier ever enters this body (live probe: switchAgent: 0
    // answered Workspace.NotAuthorised).
    expect(body).not.toContain("switchAgent");
    expect(body).toContain('"productCode":"p_efm"');
    expect(body).toContain('"consoleSite":"BAILIAN_ALIYUN"');
    expect(body).toContain('"Api":"zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/usage"');
  });
});
