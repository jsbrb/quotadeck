// Strip DOM application (WU-N/WU-O): the single place that maps a
// StripLayout onto the #bar element — class (for the CSS overrides and the
// size custom properties) plus INLINE flex-direction/height. Inline wins any
// cascade and cannot silently miss like the previous body-attribute-selector
// approach did. Kept as a pure DOM function so jsdom tests pin every
// orientation/size combination without launching the app.

import type { StripLayout } from "./strip-prefs";

export function applyLayoutToBar(bar: HTMLElement, layout: StripLayout): void {
  const vertical = layout.orientation === "vertical";
  bar.classList.toggle("vertical", vertical);
  bar.classList.toggle("size-xl", layout.size === "xl");
  bar.style.flexDirection = vertical ? "column" : "row";
  bar.style.height = vertical ? "auto" : "100%";
}
