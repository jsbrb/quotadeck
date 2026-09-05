// Popup controller (popup-ui spec §Settings Gear Surface, §Per-Model
// Consumption View, §Current Cycle Data on Open, §Key Addition with
// Validation, §Masked Key Display, §Revocation from the Popup, §Manual
// Refresh Control; AD-11/15/22/24) — owns state and DOM events over an
// injected document and browser port. The view stays pure; this module is
// the only popup code that touches the DOM.
//
// Manual refresh (hito-6): the main-view header's `data-action="refresh"`
// registers an idempotent storage.onChanged listener for `qd:snapshot`
// (local area only) and then creates the one-shot `refresh-now` alarm with
// an immediate `when` through the injected alarms port; the worker's tick
// rewrites the snapshot, and the change event re-reads + re-renders — the
// refresh flow introduces no other data path.
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
import { SnapshotStore, SNAPSHOT_STORAGE_KEY, type CycleSnapshot } from '../storage/snapshot-store';
import { readZaiPlatform, writeZaiPlatform } from '../storage/zai-platform-store';
import { renderMain, renderSettings, type PopupProvider, type PopupState } from './view';

export interface PopupDeps {
  readonly browser: BrowserApi;
  readonly document: Document;
  /** Countdown clock for display; defaults to Date.now — UI only, never provider logic. */
  readonly now?: () => number;
}

/**
 * Module-local copy of the one-shot refresh alarm name (hito-6 §Manual
 * Refresh Control; AD-24): importing background.ts would pull the entire
 * worker graph — registry, network client, providers — into the popup
 * bundle, so the popup owns its own literal; tests pin the two equal.
 */
const REFRESH_NOW_ALARM = 'refresh-now';

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
    /** Selected ZAI monitor platform; read from and persisted to `qd:pref:zai-platform`. */
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

  /**
   * Manual refresh (hito-6 §Manual Refresh Control): the storage-change
   * listener's single data path — re-read the snapshot through SnapshotStore
   * and re-render from it. No other refresh data path exists.
   */
  async function refreshFromSnapshot(): Promise<void> {
    state.snapshot = await snapshots.read();
    render();
  }
  /** Guards the one-time onChanged subscription — repeated clicks add no listeners. */
  let refreshListening = false;

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
      if (name === 'refresh') {
        // Subscribe FIRST (idempotently), THEN fire the one-shot alarm — the
        // tick's snapshot write can never race the subscription. The worker
        // handles the alarm; its qd:snapshot write lands as a change event
        // and refreshFromSnapshot re-reads + re-renders.
        if (!refreshListening) {
          refreshListening = true;
          deps.browser.storage.onChanged.listen((changes, area) => {
            if (area !== 'local' || changes[SNAPSHOT_STORAGE_KEY] === undefined) {
              return;
            }
            void refreshFromSnapshot();
          });
        }
        deps.browser.alarms.create(REFRESH_NOW_ALARM, { when: now() + 1 });
        return; // no immediate re-render: no data has changed yet
      }
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

  // Platform selector (AD-28): a change-delegated handler on the same root —
  // the select only exists in the settings view, and persistence goes through
  // the non-secret `qd:pref:zai-platform` wrapper, never the key namespace.
  root.addEventListener('change', (event) => {
    const target = event.target as HTMLElement | null;
    if (target === null || target.id !== 'zai-platform-select') {
      return;
    }
    const platform = (target as HTMLSelectElement).value;
    if (platform !== 'zai' && platform !== 'zhipu') {
      return; // the select offers exactly the union; anything else is ignored
    }
    void (async (): Promise<void> => {
      await writeZaiPlatform(deps.browser.storage.local, platform);
      state.zaiPlatform = platform;
      render();
    })();
  });

  // Initial load: last completed cycle + masked key states + the platform
  // preference, then first render.
  void (async (): Promise<void> => {
    state.snapshot = await snapshots.read();
    state.zaiPlatform = await readZaiPlatform(deps.browser.storage.local);
    for (const { id, credentialType } of providers) {
      state.keyStates[id] = await keys.readMaskedCredential(id, credentialType);
    }
    render();
  })();
}
