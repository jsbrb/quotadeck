// Popup entry (AD-11) — the ONLY popup module besides platform/ that may
// touch the `chrome` global, and only through the ChromeBrowserApi adapter.
// Mirrors background.ts's boot guard: vitest imports this module in Node,
// where no `chrome` global exists, so tests stay hermetic (AD-1).
import { ChromeBrowserApi } from '../platform/browser-api';
import { startPopup } from './controller';

if (typeof chrome !== 'undefined') {
  startPopup({ browser: new ChromeBrowserApi(), document });
}
