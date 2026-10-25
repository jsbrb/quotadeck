import { invoke } from "@tauri-apps/api/core";

// Flyout shell wiring for WU-A: only the pin toggle talks to the Rust shell.
// Provider/refresh wiring arrives in WU-C (see odd/tasks/desktop-tray-app.md).

const pinButton = document.querySelector<HTMLButtonElement>("#pin");
let pinned = false;

pinButton?.addEventListener("click", () => {
  pinned = !pinned;
  pinButton.setAttribute("aria-pressed", String(pinned));
  pinButton.classList.toggle("pinned", pinned);
  pinButton.textContent = pinned ? "UNPIN" : "PIN";
  void invoke("set_pinned", { pinned });
});
