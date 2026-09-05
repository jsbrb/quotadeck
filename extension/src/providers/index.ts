// Default registry wiring (AD-6, task 4.6). Lives in providers/, not core/,
// so the core stays free of provider implementations (AD-1). Fixed order
// zai, qwen, openai, kimi — the engine refreshes in registration order,
// which makes the badge's "last result wins" deterministic.
import { ProviderRegistry } from '../core/registry';
import { KimiProvider } from './kimi';
import { OpenAiProvider } from './openai';
import { QwenProvider } from './qwen';
import { ZaiProvider } from './zai';

export { KimiProvider, OpenAiProvider, QwenProvider, ZaiProvider };

/** Registry with the four stub providers registered in the fixed AD-6 order. */
export function createDefaultRegistry(): ProviderRegistry {
  return new ProviderRegistry()
    .register(new ZaiProvider())
    .register(new QwenProvider())
    .register(new OpenAiProvider())
    .register(new KimiProvider());
}
