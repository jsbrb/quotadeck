// Popup controller (popup-ui spec §Settings Gear Surface, §Per-Model
// Consumption View, §Current Cycle Data on Open, §Key Addition with
// Validation, §Masked Key Display, §Revocation from the Popup; AD-11/15/22/24)
// — owns state and DOM events over an injected document and browser port.
// The view stays pure; this module is the only popup code that touches the DOM.
//
// Security invariants (AD-15, structural — not conventions):
// - Credential reads go through `KeyStore.readMaskedCredential` ONLY; no
//   full-credential read is imported here, so the controller cannot observe one.
// - The full key/pair lives exclusively in the password inputs while entering;
//   on a VALID submit the inputs are cleared before re-render, so the key
//   leaves the DOM. Invalid submissions keep the text (the user is still
//   editing), which stays within "during entry".
// - The controller logs nothing.
//
// Event wiring (AD-24): the save path runs on the submit-button click AND on
// a keydown Enter in a credential input — both are dispatchable in happy-dom,
// so the Enter path has a real test; the old real-browser-only `submit`
// backstop is gone. Provider metadata comes from PROVIDER_METADATA: no
// provider class, endpoint URL or parse code enters the popup bundle.
import { validateCredential } from '../core/credentials';
import type { Credential, CredentialType, ProviderId } from '../core/provider';
import { PROVIDER_METADATA } from '../core/provider-metadata';
import type { ZaiPlatform } from '../core/zai-platforms';
import type { BrowserApi } from '../platform/browser-api';
import { KeyStore } from '../storage/key-store';
import type { MaskedCredential } from '../storage/key-store';
import { SnapshotStore, type CycleSnapshot } from '../storage/snapshot-store';
import { renderMain, renderSettings, type PopupProvider, type PopupState } from './view';

export interface PopupDeps {
  readonly browser: BrowserApi;
  readonly document: Document;
  /** Countdown clock for display; defaults to Date.now — UI only, never provider logic. */
  readonly now?: () => number;
}

/** The input ids one provider's credential form owns (two for the qwen pair). */
function credentialInputIds(id: ProviderId, type: CredentialType): readonly string[] {
  return type === 'ak-sk' ? [`key-input-${id}-ak`, `key-input-${id}-sk`] : [`key-input-${id}`];
}

export function startPopup(deps: PopupDeps): void {
  const providers: readonly PopupProvider[] = PROVIDER_METADATA; // popup-safe metadata (AD-24)
  const metadataFor = (id: ProviderId) => PROVIDER_METADATA.find((metadata) => metadata.id === id)!;
  const keys = new KeyStore(deps.browser.storage.local);
  const snapshots = new SnapshotStore(deps.browser.storage.local);
  const now = deps.now ?? Date.now;

  const state: {
    view: 'main' | 'settings';
    snapshot: CycleSnapshot | undefined;
    keyStates: Partial<Record<ProviderId, MaskedCredential | undefined>>;
    guidance: Partial<Record<ProviderId, string>>;
    /** Selected ZAI monitor platform; rendered by the selector (store wiring lands with it). */
    zaiPlatform: ZaiPlatform;
  } = { view: 'main', snapshot: undefined, keyStates: {}, guidance: {}, zaiPlatform: 'zai' };

  const app = (): HTMLElement => deps.document.getElementById('app') as HTMLElement;
  const inputById = (inputId: string): HTMLInputElement => deps.document.getElementById(inputId) as HTMLInputElement;

  /**
   * Re-renders into #app. Typed-but-unsubmitted input values are carried over
   * via the DOM value property (never innerHTML), so an invalid submission can
   * keep the user's text without the full key entering the rendered markup.
   */
  function render(): void {
    const live: Record<string, string> = {};
    for (const input of Array.from(deps.document.querySelectorAll('#app input'))) {
      live[input.id] = (input as HTMLInputElement).value;
    }
    const popupState: PopupState = {
      view: state.view,
      providers,
      snapshot: state.snapshot,
      keyStates: state.keyStates,
      guidance: state.guidance,
      zaiPlatform: state.zaiPlatform,
      nowMs: now(),
    };
    app().innerHTML = state.view === 'main' ? renderMain(popupState) : renderSettings(popupState);
    for (const [inputId, value] of Object.entries(live)) {
      const input = deps.document.getElementById(inputId);
      if (input !== null) {
        (input as HTMLInputElement).value = value;
      }
    }
  }

  /** Reads the provider's form inputs into a typed credential candidate. */
  function credentialFromInputs(id: ProviderId): Credential {
    const type = metadataFor(id).credentialType;
    if (type === 'ak-sk') {
      return {
        type,
        accessKeyId: inputById(`key-input-${id}-ak`).value,
        accessKeySecret: inputById(`key-input-${id}-sk`).value,
      };
    }
    return { type, token: inputById(`key-input-${id}`).value };
  }

  async function submitCredential(id: ProviderId): Promise<void> {
    const type = metadataFor(id).credentialType;
    const credential = credentialFromInputs(id);
    const result =
      credential.type === 'ak-sk'
        ? validateCredential('ak-sk', { accessKeyId: credential.accessKeyId, accessKeySecret: credential.accessKeySecret })
        : validateCredential(type, credential.token);
    if (!result.ok) {
      state.guidance[id] = result.message;
      render(); // keeps the typed values (AD-15: still entering)
      return;
    }
    delete state.guidance[id];
    await keys.saveCredential(id, credential);
    state.keyStates[id] = await keys.readMaskedCredential(id, type);
    for (const inputId of credentialInputIds(id, type)) {
      inputById(inputId).value = ''; // the full credential leaves the DOM on valid submit
    }
    render();
  }

  async function revokeCredential(id: ProviderId): Promise<void> {
    await keys.revokeCredential(id);
    state.keyStates[id] = await keys.readMaskedCredential(id, metadataFor(id).credentialType);
    delete state.guidance[id];
    render();
  }

  const root = app();
  root.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const revoke = target.closest('[data-revoke]');
    if (revoke !== null) {
      void revokeCredential(revoke.getAttribute('data-revoke') as ProviderId);
      return;
    }
    const action = target.closest('[data-action]');
    if (action !== null) {
      const name = action.getAttribute('data-action');
      if (name === 'open-settings') {
        state.view = 'settings';
      } else if (name === 'back') {
        state.view = 'main';
      } else {
        return;
      }
      render();
      return;
    }
    const submit = target.closest('button[type="submit"]');
    if (submit !== null) {
      event.preventDefault(); // cancel native form submission
      const form = submit.closest('form');
      const id = form?.getAttribute('data-provider');
      if (id !== null) {
        void submitCredential(id as ProviderId);
      }
    }
  });
  // Enter submits the focused provider's form (AD-24: replaces the untestable
  // real-browser submit backstop — this path is dispatchable in happy-dom).
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') {
      return;
    }
    const input = (event.target as HTMLElement | null)?.closest('input');
    const form = input?.closest('form.key-form');
    if (form === null || form === undefined || input === null) {
      return;
    }
    event.preventDefault(); // one user action processes once
    const id = form.getAttribute('data-provider');
    if (id !== null) {
      void submitCredential(id as ProviderId);
    }
  });

  // Initial load: last completed cycle + masked key states, then first render.
  void (async (): Promise<void> => {
    state.snapshot = await snapshots.read();
    for (const { id, credentialType } of providers) {
      state.keyStates[id] = await keys.readMaskedCredential(id, credentialType);
    }
    render();
  })();
}
