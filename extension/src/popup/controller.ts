// Popup controller (popup-ui spec §Current Cycle Data on Open, §Key Addition
// with Validation, §Revocation from the Popup; AD-11/AD-15) — owns state and
// DOM events over an injected document and browser port. The view stays pure;
// this module is the only popup code that touches the DOM.
//
// Security invariants (AD-15, structural — not conventions):
// - Credential reads go through `KeyStore.readMaskedKey` ONLY; `readKey` is
//   never imported here, so the controller cannot even observe a full key.
// - The full key lives exclusively in the password input while entering; on a
//   VALID submit the input is cleared before re-render, so the key leaves the
//   DOM. Invalid submissions keep the text (the user is still editing), which
//   stays within "during entry".
// - The controller logs nothing.
//
// Event wiring note: happy-dom does not fire a form's `submit` event when a
// submit button is clicked, so the save path runs on the submit-button click
// (default prevented — this also cancels native form submission in real
// Chrome). A `submit` listener remains as the Enter-key backstop for real
// browsers, guarded by `defaultPrevented` so one user action processes once.
import { validateCredential } from '../core/credentials';
import type { ProviderId } from '../core/provider';
import type { BrowserApi } from '../platform/browser-api';
import { createDefaultRegistry } from '../providers';
import { KeyStore } from '../storage/key-store';
import { SnapshotStore, type CycleSnapshot } from '../storage/snapshot-store';
import { renderPopup, type PopupProvider, type PopupState } from './view';

export interface PopupDeps {
  readonly browser: BrowserApi;
  readonly document: Document;
}

export function startPopup(deps: PopupDeps): void {
  const registry = createDefaultRegistry(); // single source of metadata (AD-6)
  const providers: readonly PopupProvider[] = registry.ids().map((id) => ({
    id,
    displayName: registry.get(id).displayName,
  }));
  const keys = new KeyStore(deps.browser.storage.local);
  const snapshots = new SnapshotStore(deps.browser.storage.local);

  const state: {
    snapshot: CycleSnapshot | undefined;
    keyStates: Partial<Record<ProviderId, string | undefined>>;
    guidance: Partial<Record<ProviderId, string>>;
  } = { snapshot: undefined, keyStates: {}, guidance: {} };

  const app = (): HTMLElement => deps.document.getElementById('app') as HTMLElement;
  const inputFor = (id: ProviderId): HTMLInputElement =>
    deps.document.getElementById(`key-input-${id}`) as HTMLInputElement;

  /**
   * Re-renders into #app. Typed-but-unsubmitted input values are carried over
   * via the DOM value property (never innerHTML), so an invalid submission can
   * keep the user's text without the full key entering the rendered markup.
   */
  function render(): void {
    const live: Partial<Record<ProviderId, string>> = {};
    for (const { id } of providers) {
      const input = deps.document.getElementById(`key-input-${id}`);
      if (input !== null) {
        live[id] = (input as HTMLInputElement).value;
      }
    }
    const popupState: PopupState = {
      providers,
      snapshot: state.snapshot,
      keyStates: state.keyStates,
      guidance: state.guidance,
    };
    app().innerHTML = renderPopup(popupState);
    for (const { id } of providers) {
      if (live[id] !== undefined) {
        inputFor(id).value = live[id];
      }
    }
  }

  async function submitKey(id: ProviderId, credential: string): Promise<void> {
    const result = validateCredential(registry.get(id).credentialType, credential);
    if (!result.ok) {
      state.guidance[id] = result.message;
      render(); // keeps the typed value (AD-15: still entering)
      return;
    }
    delete state.guidance[id];
    await keys.saveKey(id, credential);
    state.keyStates[id] = await keys.readMaskedKey(id);
    inputFor(id).value = ''; // the full key leaves the DOM on valid submit
    render();
  }

  async function revokeKey(id: ProviderId): Promise<void> {
    await keys.revokeKey(id);
    state.keyStates[id] = await keys.readMaskedKey(id);
    delete state.guidance[id];
    render();
  }

  const root = app();
  root.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const revoke = target.closest('[data-revoke]');
    if (revoke !== null) {
      void revokeKey(revoke.getAttribute('data-revoke') as ProviderId);
      return;
    }
    const submit = target.closest('button[type="submit"]');
    if (submit !== null) {
      event.preventDefault(); // cancel native form submission
      const form = submit.closest('form');
      const id = form?.getAttribute('data-provider');
      if (id !== null) {
        void submitKey(id as ProviderId, inputFor(id as ProviderId).value);
      }
    }
  });
  root.addEventListener('submit', (event) => {
    if (event.defaultPrevented) {
      return; // already processed by the click path
    }
    event.preventDefault();
    const id = (event.target as HTMLFormElement).getAttribute('data-provider');
    if (id !== null) {
      void submitKey(id as ProviderId, inputFor(id as ProviderId).value);
    }
  });

  // Initial load: last completed cycle + masked key states, then first render.
  void (async (): Promise<void> => {
    state.snapshot = await snapshots.read();
    for (const { id } of providers) {
      state.keyStates[id] = await keys.readMaskedKey(id);
    }
    render();
  })();
}
