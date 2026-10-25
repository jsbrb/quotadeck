---
name: Neo-Brutalist Developer Instrument
colors:
  surface: '#fafaf4'
  surface-dim: '#dadad5'
  surface-bright: '#fafaf4'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f4f4ee'
  surface-container: '#eeeee8'
  surface-container-high: '#e8e8e3'
  surface-container-highest: '#e3e3dd'
  on-surface: '#1a1c19'
  on-surface-variant: '#47464b'
  inverse-surface: '#2f312d'
  inverse-on-surface: '#f1f1eb'
  outline: '#77767b'
  outline-variant: '#c8c5cb'
  surface-tint: '#5f5e61'
  primary: '#000000'
  on-primary: '#ffffff'
  primary-container: '#1b1b1e'
  on-primary-container: '#858387'
  inverse-primary: '#c8c5ca'
  secondary: '#6d5e00'
  on-secondary: '#ffffff'
  secondary-container: '#fcdf46'
  on-secondary-container: '#726200'
  tertiary: '#000000'
  on-tertiary: '#ffffff'
  tertiary-container: '#001f23'
  on-tertiary-container: '#00929f'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e4e1e6'
  primary-fixed-dim: '#c8c5ca'
  on-primary-fixed: '#1b1b1e'
  on-primary-fixed-variant: '#47464a'
  secondary-fixed: '#ffe24c'
  secondary-fixed-dim: '#e2c62d'
  on-secondary-fixed: '#211b00'
  on-secondary-fixed-variant: '#524600'
  tertiary-fixed: '#91f1ff'
  tertiary-fixed-dim: '#54d8e8'
  on-tertiary-fixed: '#001f23'
  on-tertiary-fixed-variant: '#004f57'
  background: '#fafaf4'
  on-background: '#1a1c19'
  surface-variant: '#e3e3dd'
typography:
  headline-lg:
    fontFamily: Space Grotesk
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 28px
    letterSpacing: -0.03em
  headline-md:
    fontFamily: Space Grotesk
    fontSize: 18px
    fontWeight: '700'
    lineHeight: 22px
    letterSpacing: -0.02em
  headline-sm:
    fontFamily: Space Grotesk
    fontSize: 15px
    fontWeight: '600'
    lineHeight: 18px
    letterSpacing: -0.01em
  body-md:
    fontFamily: Space Grotesk
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 16px
  body-sm:
    fontFamily: Space Grotesk
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 14px
  label-lg:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: -0.01em
  label-md:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 14px
    letterSpacing: 0.02em
  label-sm:
    fontFamily: JetBrains Mono
    fontSize: 10px
    fontWeight: '500'
    lineHeight: 12px
    letterSpacing: 0.04em
  metric-display:
    fontFamily: JetBrains Mono
    fontSize: 20px
    fontWeight: '700'
    lineHeight: 22px
    letterSpacing: -0.02em
spacing:
  gutter: 0.5rem
  margin: 0.75rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1rem
  space-xl: 1.5rem
---

## Brand & Style
This design system defines an ultra-tactile, high-density developer utility built for compact environments such as browser extensions and persistent side-panels. It balances technical precision with playful physical metaphors through the lens of modern neo-brutalism. 

The aesthetic is characterized by raw ink-on-paper contrast, deliberate black stroke work, and instant kinetic feedback. Rather than feeling sterile or industrial, warm unbleached paper undertones paired with punchy chromatic signaling provide an inviting yet hyper-efficient cockpit experience. It eschews modern UI illusions—strictly rejecting blur filters, skeuomorphic gloss, gradients, and soft ambient drop shadows—in favor of structural honesty, crisp hard-offset geometry, and high tabular data legibility.

## Colors
The palette relies on a tactile paper canvas accented with ink-heavy outlines and saturated signal tones.

- **Canvas & Ink**: The background is anchored by `#FDFDF7` (Warm Paper), while all dominant strokes, typography, and structural borders use `#18181B` (Ink Black). High-contrast surfaces utilize pure white `#FFFFFF` for data cards against the warm paper background.
- **Accents**: Neo-brutalist utility accents include `#FDE047` (Electric Yellow) for focal indicators and system alerts, alongside `#67E8F9` (Electric Cyan) and `#F472B6` (Signal Pink) for secondary metadata tags and interactive badges.
- **Metric Thresholds**: Status and threshold alerts strictly obey three functional bands:
  - Nominal (<70%): `#16A34A` (Vibrant Leaf Green)
  - Warning (≥70% and <90%): `#F59E0B` (Punchy Amber)
  - Critical (≥90%): `#DC2626` (Sharp Crimson)
- **Rules**: Zero color gradients. All fills must be opaque and solid.

## Typography
Typography is divided between expressive geometric structure and precise monospaced telemetry:

- **Headlines & Text (`Space Grotesk`)**: Provides an unapologetic, mechanical, and chunky visual cadence. Headings use tight letter-spacing and heavy weights to command visual priority within a compact 360px viewport.
- **Telemetry & Labels (`JetBrains Mono`)**: Applied across all metrics, quotas, percentages, timestamps, and metadata tags. Tabular figures (`tnum`) ensure absolute horizontal alignment during dynamic quota counter updates.
- **Discipline**: Never substitute emojis for iconography or indicators. Use uppercase monospaced labels for micro-tags and telemetry categories.

## Layout & Spacing
Optimized specifically for fixed-canvas constraints (fixed 360x600 px viewport):

- **Grid Architecture**: Rigid 4-column compact grid with 8px (`0.5rem`) gutters and 12px (`0.75rem`) outer canvas margins. Space conservation is paramount; whitespace exists purely as structural air gaps between stark black boundaries.
- **Rhythm**: All structural margins, padding, and gaps align to a strict 4px base increment. Data tables and status cards employ dense internal paddings (`space-xs` and `space-sm`) to maximize visible information density without scrolling.
- **Reflow**: If scaled within side-panels or wider dashboards, the grid expands to 6 or 12 columns while maintaining identical gutter rhythms and solid vertical dividers.

## Elevation & Depth
Elevation is achieved exclusively through hard, unblurred chromatic offsets. Soft drop shadows, blur radii, and diffusion are strictly prohibited.

- **Resting Elevation**: Components rest with an unblurred `4px 4px 0px #18181B` hard drop shadow against the `#FDFDF7` background, bounded by a uniform `2px solid #18181B` border.
- **Sub-Cards & Inset Wells**: Secondary interior panels reduce the offset to `2px 2px 0px #18181B`. Recessed data zones use an inverted inset border or solid `#18181B` fill with high-contrast inverted text.
- **Active / Pressed State**: On click or active touch, the element physically shifts down and right by `2px` or `4px` (`transform: translate(4px, 4px)`), collapsing the drop shadow to `0px 0px 0px #18181B` to simulate a physical mechanical punch-switch.

## Shapes
Geometry is strictly non-filleted (`0` sharp edges):

- **Borders & Corners**: All surfaces, buttons, popovers, badges, and progress tracks have a border-radius of `0px`. Rounding or organic curves are forbidden.
- **Linework**: All component perimeters use an unwavering `2px solid #18181B` stroke width. Nested cards maintain the same 2px stroke, ensuring high tactile weight throughout nested hierarchies.
- **Dividers**: Interior rule dividers are rendered as `2px solid #18181B` rules or dashed `2px dashed #18181B` markers for tabular row separations.

## Components

### Buttons
- **Style**: Solid rectangular blocks with `2px solid #18181B` and `4px 4px 0px #18181B` offset shadow.
- **Variants**:
  - *Primary*: `#FDE047` background with `#18181B` heavy label text.
  - *Secondary*: `#FFFFFF` background with `#18181B` text.
  - *Destructive / Alert*: `#DC2626` background with `#FFFFFF` text.
- **Interaction**: On active state, button translates `4px 4px` with zero shadow (`box-shadow: 0 0 0 #18181B`), providing tactile click confirmation.

### Badges & Threshold Chips
- **Geometry**: Compact boxes, `0px` radius, `1.5px` or `2px solid #18181B`, `0px` offset shadow.
- **Typography**: Monospaced 10px uppercase (`label-sm`).
- **Color Rules**:
  - Green Badge: Background `#DCFCE7`, text `#16A34A`, border `#18181B`.
  - Amber Badge: Background `#FEF3C7`, text `#B45309`, border `#18181B`.
  - Red Alert Badge: Background `#FEE2E2`, text `#DC2626`, border `#18181B`.
  - Accent Badges: Solid `#67E8F9` (Cyan) or `#FDE047` (Yellow) with `#18181B` text.

### Metric Progress Bars
- **Container**: Rectangular trough with `#FFFFFF` background and `2px solid #18181B`.
- **Fill**: Completely solid fill with zero rounding. Segmented stepped ticks indicated by `2px solid #18181B` vertical notch lines at 25%, 50%, 75%, and 90%.
- **Color Fill Rule**:
  - `< 70%`: Fill is `#16A34A`.
  - `70% - 89%`: Fill switches instantly to `#F59E0B`.
  - `≥ 90%`: Fill switches to `#DC2626`.

### Cards & Grouping Containers
- **Visuals**: `#FFFFFF` background, `2px solid #18181B`, `4px 4px 0px #18181B` shadow, padding of `0.75rem`.
- **Header Slot**: Integrated top banner with a bottom `2px solid #18181B` border separating header from content.

### Inputs & Toggles
- **Input Fields**: Crisp white interior, `2px solid #18181B`, monospaced placeholder text `#71717A`. On focus, shifts to a hard `2px 2px 0px #18181B` shadow with `#18181B` border.
- **Checkboxes & Radios**: Square checkboxes (`16x16px`) with `2px solid #18181B`. Checked state renders as a solid interior black square `#18181B` with 2px inset margins.
- **Switches / Toggles**: Rectangular track (`20x36px`) with a sliding solid square block handle (`12x12px`), maintaining the `2px solid #18181B` outline throughout.