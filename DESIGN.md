# ask'em Visual Style Guide

## 1. Overall Direction

ask'em is no longer a direct Claude-style reproduction. The shipped UI is better described as a **warm editorial utility UI**:

- Claude-adjacent in mood
- more compact and productized
- more translucent and layered
- more rounded and utility-oriented in controls
- split across two surfaces:
  - a warm popup workspace
  - a floating on-page sync overlay

The popup is built around a parchment base with subtle atmospheric texture. It feels tactile and calm, but it is denser and more operational than a marketing site. The content-side pill and panel inherit the same “soft, premium, not-techy” intent, but use slightly cooler glass surfaces so they can sit on arbitrary third-party websites without visually collapsing.

This means the current style is **not**:

- a pure Anthropic website clone
- a strict editorial website system
- a flat neutral extension UI

It is a hybrid: **warm reading-room popup + glassy assistant overlay**.

## 2. Color System

### Core Popup Palette

These values come from the actual tokens in [src/styles/popup/tokens.css](/Users/zhongxi/code/other/ask-em/src/styles/popup/tokens.css).

- **Ink** `#141413`
  Primary text. Warm near-black, not pure black.
- **Muted** `#5e5d59`
  Secondary text and subdued controls.
- **Body** `#454035`
  Mid-tone body / utility foreground.
- **Base Background** `#f5f4ed`
  The popup’s parchment canvas.
- **Accent** `#c96442`
  Terracotta brand accent, used sparingly.
- **Danger** `#b53333`
- **Warn** `#9c6b00`
- **Success** `#1f7a59`

### Surface Treatment

The popup does not use flat solids as its main visual identity. Most surfaces are slightly translucent and lightly layered:

- soft white surfaces at `0.72–0.96` opacity
- warm cream card gradients
- low-contrast brown borders
- a terracotta radial wash in some cards and the page background
- a fine stripe texture in the shell background

Important nuance: the system is **warmer than generic SaaS**, but **more atmospheric than the current DESIGN.md previously implied**. Gradients and translucent layers are absolutely part of the shipped implementation.

### Content Overlay Palette

The content-side sync pill and panel are a little cooler and more neutral than the popup:

- white-cream glass background
- darker slate-tinted text and borders
- green success, amber warning, stone muted states

This is intentional. The overlay must remain legible on top of many third-party sites, so it cannot lean as fully into the popup’s parchment world.

## 3. Typography

The previous document over-indexed on custom Anthropic fonts. The current implementation is simpler and more practical:

- **Serif display / headings**: `Georgia, "Times New Roman", serif`
- **UI sans**: `"Avenir Next", "Segoe UI", sans-serif`

This difference matters. The current UI feels less “brand-type-system showcase” and more “well-tuned native desktop utility with editorial hints.”

### Actual Hierarchy in the Popup

- **Brand wordmark**: 34px serif, weight 500, tight tracking and tight line-height
- **Section headings**: 28px serif
- **Card headings**: 20–26px serif depending on context
- **Modal headings**: 24–28px serif
- **Body / helper text**: mostly 13px sans
- **Small utility text**: 11–12px sans
- **Micro labels / chips / controls**: 9–10px sans, uppercase, strong letter-spacing

### Typography Principles

- Serif is used for brand moments and section anchors, not everywhere.
- Sans does almost all operational work.
- Small uppercase utility labels are a major part of the visual language.
- The UI feels compact, but not cramped.
- Body text is readable and warm, but not “essay-like” in the way a long-form editorial site would be.

## 4. Button and Control Language

This is one of the biggest mismatches with the old DESIGN.md.

The current product relies on **soft rounded controls**, **micro-uppercase labels**, and **soft translucent fills**.

### Primary Button Families

#### Standard Utility Buttons

Used for refresh, clear, modal actions, and general controls.

- elongated rounded shape
- thin warm border
- soft white translucent background
- uppercase sans at 10px
- hover is mostly a border/background refinement, not a dramatic transformation

These are not “marketing CTA buttons.” They are compact, polished control surfaces.

#### Subtle Text Buttons

Used for top-right small actions like `Dev` / `Feedback`.

- borderless
- low visual weight
- tiny uppercase text
- understated underline-on-hover treatment

This gives the popup some editorial restraint and keeps utility actions from overpowering the main content.

#### Chip / Toggle Controls

Used for providers, diagnostics toggles, request chips, etc.

- compact rounded containers
- uppercase micro-labels
- active state uses warm accent-surface rather than loud solid fill
- active emphasis comes from border + surface + inset light, not saturated color blocks

#### Switches

Used in settings rows.

- simple rounded track
- white thumb
- green “on” state
- no ornamental framing

This is one of the few places where the system intentionally becomes more literal and OS-like.

### Control Philosophy

- Prefer **contained softness** over high-contrast chrome.
- Prefer **shape consistency** over lots of button variants.
- Let **copy hierarchy** do more work than color.
- Use terracotta as emphasis, not as default button fill.

## 5. Cards, Panels, and Containers

### Popup Cards

Popup cards are characterized by:

- 22–24px border radius
- warm cream gradient background
- soft blur / glass treatment
- low-contrast warm border
- medium soft shadow

They feel plush, slightly translucent, and premium, but still compact enough for a browser extension popup.

### Modal Surfaces

Modals are similar, but a little flatter and more concentrated:

- cream-tinted near-opaque surface
- 24px-ish radius
- warm border
- moderate shadow

The modal design is intentionally quieter than the popup shell. It reads as an overlay layer, not a new scene.

### Settings Rows

The settings page is not card-heavy in the same way as a dashboard. It uses:

- internal dividers
- row-based structure
- compact copy
- small reset affordances

This gives the settings page a more tool-like rhythm.

## 6. Background, Texture, and Atmosphere

The old document understated the amount of atmosphere in the shipped UI.

The popup shell uses:

- base parchment fill
- soft terracotta radial glow
- fine stripe overlay
- translucent panel layering

These details matter. They keep the popup from feeling like a plain beige extension.

At the same time, the current atmosphere is still restrained:

- no loud gradients
- no decorative illustrations
- no dramatic color blocking
- no large visual storytelling sections

So the correct framing is: **subtle atmospheric texture, not expressive illustration-led branding**.

## 7. Content-Side Overlay Style

The floating sync pill and expanded panel follow a slightly different rule set from the popup:

- stronger blur
- tighter rounded geometry
- slightly cooler text/borders
- stronger shadow for legibility over third-party pages
- more explicit semantic colors for success/warning/blocked states

The floating control is meant to feel premium and calm, but also unmistakably actionable in hostile visual environments.

Notable characteristics:

- near-full capsule radius
- uppercase 11px label text
- small status dot with glow
- glass panel with cream-to-warm gradient
- stronger shadow than the popup cards

This is less “editorial card” and more “floating instrument.”

## 8. Spacing and Density

The current UI is more compact than the previous DESIGN.md suggested.

### Popup

- shell padding: about 20px
- inter-section gaps: about 18px
- card padding: about 15–18px
- row spacing: 8–14px

### Density Philosophy

- Compact enough to fit meaningful controls in a popup
- Spacious enough to avoid browser-extension claustrophobia
- Copy blocks are short; spacing is tuned for scanning, not long reading

So while the mood is warm/editorial, the interaction density is still fundamentally **utility-first**.

## 9. Depth and Elevation

Actual depth is created by a combination of:

- warm low-contrast borders
- translucent surfaces
- backdrop blur
- soft drop shadows
- occasional inset highlights

This is another place where the old doc was too narrow. The current system is **not only ring-shadow based**.

### Actual Elevation Pattern

- popup shell: texture + layered background
- cards: soft shadow + warm border + gradient surface
- chips/buttons: mostly border + translucent fill
- modals: stronger shadow, near-opaque surface
- content overlay: strongest shadow and blur in the system

## 10. Practical Do / Don’t

### Do

- Keep the popup warm, parchment-based, and softly atmospheric.
- Use serif only for headings, titles, and brand moments.
- Use Avenir Next / Segoe-style sans for utility and controls.
- Keep buttons softly rounded and compact.
- Use terracotta as a restrained accent, not as default fill everywhere.
- Preserve the distinction between popup warmth and content-overlay neutrality.
- Keep utility labels uppercase and tightly tracked.
- Prefer soft borders and translucent fills over hard chrome.

### Don’t

- Don’t describe the system as a pure Claude landing-page clone anymore.
- Don’t assume custom Anthropic fonts are part of the implementation.
- Don’t document the system as gradient-free; it is not.
- Don’t overstate illustration or editorial storytelling; the shipped product is more operational.
- Don’t turn controls into loud SaaS primary buttons.
- Don’t flatten the popup into plain beige cards; the texture and layering are part of the identity.
- Don’t make the content overlay as warm and diffuse as the popup; it needs more contrast and neutrality.

## 11. One-Sentence Summary

The current ask'em UI is a **warm, serif-accented, parchment-and-glass utility system**: editorial in tone, compact in density, softly rounded in its controls, and slightly cooler plus more contrasty in its floating in-page overlay.
