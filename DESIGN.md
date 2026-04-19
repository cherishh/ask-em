# Warm Editorial Utility Design Guide

## 1. Overall Direction

This system is a **warm editorial utility** style.

It is designed for:

- landing pages
- product surfaces
- lightweight web apps
- launch assets
- presentation decks
- marketing materials

The style combines:

- the calm authority of editorial design
- the clarity of a practical product interface
- the softness and tactility of physical materials

It should feel:

- warm, not cold
- composed, not flashy
- premium, not glossy
- useful, not mechanical
- quiet, not sterile

This is not a futuristic AI aesthetic. It should avoid cold blue-gray palettes, harsh geometric severity, and loud startup-style contrast. The mood is closer to a reading room, a carefully printed booklet, or a well-made notebook than to a generic SaaS dashboard.

## 2. Core Characteristics

### What Defines the Style

- parchment and cream foundations instead of pure white
- warm near-black text instead of absolute black
- serif-led headlines paired with a quiet sans
- low-contrast borders and soft elevation
- restrained earth-tone accents
- subtle gradients, translucency, and texture
- compact, softly rounded controls
- a balance between editorial calm and interface utility

### What It Is Not

- not a pure Claude clone
- not a strict magazine layout system
- not a glossy luxury brand
- not a flat neutral SaaS design system
- not illustration-led by default

## 3. Color Palette

### Primary Palette

| Token | Value | Use |
|------|------|------|
| Ink | `#141413` | Primary text, strongest contrast |
| Body | `#454035` | Default body text, utility foreground |
| Muted | `#5e5d59` | Secondary text, helper copy |
| Stone | `#87867f` | Tertiary text, inactive states |
| Parchment | `#f5f4ed` | Main page background |
| Ivory | `#faf9f5` | Elevated light surfaces |
| Warm Sand | `#e8e6dc` | Borders, dividers, quiet fills |
| Accent | `#c96442` | Primary brand accent |
| Accent Soft | `#d97757` | Accent hover, warm highlight |
| Success | `#1f7a59` | Positive state |
| Warning | `#9c6b00` | Caution state |
| Danger | `#b53333` | Destructive state |

### Palette Rules

- All neutrals should stay warm.
- Avoid icy grays and cool white backgrounds.
- Use `Ink` for high-priority text, not for every text layer.
- Use `Muted` and `Stone` to create pacing and quiet hierarchy.
- Accent color should be sparing and intentional.
- Parchment should feel like the ambient environment, not just a background fill.

### Surface Treatments

The system works best when flat color is softened with light atmospheric treatment:

- cream-tinted surfaces
- subtle linear or radial gradients
- low-opacity white overlays
- warm, low-contrast borders
- fine stripe or grain textures
- occasional soft terracotta glow

These treatments should be visible only on close inspection. They are there to create warmth and depth, not spectacle.

## 4. Typography

### Font Pairing

Use:

- **Serif display**: `Georgia, "Times New Roman", serif`
- **UI sans**: `"Avenir Next", "Segoe UI", sans-serif`

Equivalent substitutes are acceptable, but the pairing should preserve the same relationship:

- serif with literary calm, not ornamental drama
- sans with quiet practicality, not tech-brand sharpness

### Hierarchy

| Role | Font | Size | Weight | Line Height | Notes |
|------|------|------|--------|-------------|------|
| Display Hero | Serif | 52–64px | 500 | 1.05–1.10 | Hero statements, campaign titles |
| Section Heading | Serif | 32–40px | 500 | 1.10–1.20 | Page sections, major blocks |
| Card / Feature Title | Serif | 20–28px | 500 | 1.15–1.25 | Cards, callouts, feature groups |
| Subheading | Sans | 16–18px | 500 | 1.30–1.45 | Supporting emphasis |
| Body | Sans | 13–16px | 400–500 | 1.45–1.60 | Main copy |
| Small | Sans | 11–12px | 400–500 | 1.35–1.50 | Metadata, secondary controls |
| Micro Label | Sans | 9–10px | 500 | 1.20–1.40 | Overlines, chips, compact controls |

### Typography Rules

- Serif should mark major moments, not every heading.
- Sans should carry most operational text.
- Small uppercase labels are part of the system and should use letter-spacing.
- Body copy should be concise and scannable, not essay-like.
- Serif weights should stay restrained; avoid heavy bold display typography.
- The system should feel poised and editorial, not theatrical.

### Letter-Spacing

- Display serif: `0` to `-0.02em`
- UI body sans: `0`
- Micro uppercase labels: `0.08em` to `0.14em`

## 5. Buttons and Controls

### Control Philosophy

Controls should feel compact, polished, and calm. They should not behave like loud consumer CTAs unless the design is explicitly campaign-driven.

Key rules:

- use soft rounding
- keep fills restrained
- use borders for structure
- let hierarchy and spacing do part of the work
- use accent fills sparingly

### Primary Button

- Background: `#141413` or `#c96442` depending on emphasis
- Text: `#faf9f5`
- Radius: `12px`
- Padding: `8px 16px`
- Font: sans, `10–12px`, uppercase for compact utility actions or `13–14px` sentence case for marketing CTAs
- Border: optional `1px solid rgba(20, 20, 19, 0.08)` on warm surfaces
- Shadow: soft, low spread, not dramatic

Use for:

- main page CTA
- confirm actions
- strongest call-to-action in a group

### Secondary Utility Button

- Background: `rgba(255, 255, 255, 0.82)` or `#e8e6dc`
- Text: `#454035`
- Radius: `999px` or `12px` depending on context
- Padding: `7px 14px`
- Border: `1px solid rgba(94, 93, 89, 0.16)`
- Font: sans, `10px`, uppercase with tracking

Use for:

- utility actions
- filters
- lightweight page tools
- secondary modal actions

### Text Action

- No visible container by default
- Text: `#5e5d59`
- Font: sans, `10–12px`, uppercase or compact sentence case
- Hover: underline, tint darkening, or slight opacity shift

Use for:

- minor actions
- dismissive actions
- utility links in headers or footers

### Segmented / Chip Controls

- Background: translucent cream or very light accent tint
- Border: thin warm outline
- Radius: `999px`
- Text: `9–10px` uppercase sans
- Active state: warm accent-tinted surface, not loud solid fill

Use for:

- mode switches
- filters
- compact selection states

### Switches

- Track: muted warm neutral
- Active track: success green or deep accent-tinted neutral
- Thumb: white
- Shape: rounded, quiet, OS-like

Switches should look literal and trustworthy, not ornamental.

## 6. Cards, Panels, and Containers

### Standard Card

- Background: ivory or cream-tinted white
- Border: `1px solid rgba(94, 93, 89, 0.12)`
- Radius: `20–24px`
- Padding: `16–20px`
- Shadow: `0 10px 30px rgba(20, 20, 19, 0.06)`

### Elevated Feature Card

- Background: subtle cream gradient
- Border: `1px solid rgba(94, 93, 89, 0.14)`
- Radius: `24px`
- Padding: `20–28px`
- Shadow: `0 18px 50px rgba(20, 20, 19, 0.08)`
- Optional: soft radial warmth in one corner

### Modal / Sheet Surface

- Background: near-opaque warm cream
- Radius: `24px`
- Border: thin warm border
- Shadow: stronger than cards, still soft
- Interior layout: row-based, not overly decorative

### Divided Rows

For settings, comparison lists, and structured information:

- use top borders or subtle separators
- keep row heights compact
- use a left content / right action rhythm
- use muted descriptive copy below primary labels

## 7. Background, Texture, and Atmosphere

### Base Background

Recommended base:

- `#f5f4ed`

Recommended enhancement layers:

- low-opacity white wash
- soft terracotta radial glow
- fine stripe or grain texture

### Texture Rules

- texture should be felt more than seen
- never let texture compete with text
- large areas of pure flat color should be avoided where possible
- subtle atmosphere is preferable to heavy decoration

### Dark Use

If a dark surface is needed:

- use warm charcoal, not cool graphite
- keep contrast high enough for reading
- use warm silver text instead of icy gray
- avoid neon accents

## 8. Layout and Spacing

### Spacing Scale

Base unit: `4px`

Recommended scale:

- `4`
- `8`
- `12`
- `16`
- `20`
- `24`
- `32`
- `40`
- `56`
- `72`

### Density

This system works best in the middle ground:

- more compact than a brand marketing site
- more breathable than a dense dashboard
- more structured than an art-directed editorial spread

### Content Rhythm

- Hero to section spacing: `56–72px`
- Section to section spacing: `40–56px`
- Card internal spacing: `16–24px`
- Tight utility row gaps: `8–12px`
- Standard content gaps: `14–18px`

### Container Width

For landing pages and broad marketing surfaces:

- primary content width: `1040–1200px`

For denser product surfaces:

- working content width: `320–760px` modules inside broader layouts

## 9. Border Radius

Recommended radius system:

- `8px`: tight utility controls
- `12px`: standard buttons and inputs
- `16px`: medium panels and grouped controls
- `20–24px`: premium cards, sheets, hero modules
- `999px`: chips, pills, segmented controls

Rules:

- stay within one family of radii
- prefer soft corners over sharp corners
- do not mix very sharp and very soft geometry in the same composition

## 10. Depth and Shadows

### Elevation Pattern

| Level | Treatment | Use |
|------|------|------|
| Flat | no shadow, low-contrast border | base sections, quiet areas |
| Surface | `0 6px 20px rgba(20, 20, 19, 0.04)` | standard cards |
| Elevated | `0 10px 30px rgba(20, 20, 19, 0.06)` | active surfaces, feature cards |
| Floating | `0 20px 60px rgba(20, 20, 19, 0.10)` | modals, floating panels |

### Shadow Rules

- Shadows should be blurred and soft.
- Avoid sharp material shadows.
- Borders and tonal contrast should do as much work as shadows.
- Use inset highlights sparingly for active states.
- Depth should feel atmospheric, not mechanical.

## 11. Responsive Behavior

### Breakpoints

| Name | Width |
|------|------|
| Mobile | `< 640px` |
| Tablet | `640–991px` |
| Desktop | `992px+` |

### Responsive Rules

- Stack multi-column sections on mobile.
- Reduce serif headline sizes before reducing whitespace too aggressively.
- Keep card padding generous enough to preserve softness.
- Maintain visual hierarchy even when layouts collapse.
- Do not compress controls to the point of feeling technical or cramped.

## 12. Applications

### Best Fit Use Cases

- AI or productivity landing pages
- product launch pages
- pricing or feature comparison pages
- onboarding surfaces
- settings or preference views
- announcement decks
- campaign one-pagers

### How to Adapt by Format

For landing pages:

- lean more heavily on serif headlines and spacious section pacing
- allow larger hero typography
- keep CTA count low

For product UI:

- tighten spacing
- reduce decorative atmosphere slightly
- rely more on muted text, dividers, and row structure

For slides or collateral:

- preserve the palette and type pairing
- simplify interaction language into framing, labels, and callout cards

## 13. Do / Don't

### Do

- Use warm neutrals as the environment.
- Use serif for emphasis and sans for work.
- Keep controls compact and quietly refined.
- Add subtle atmospheric treatment to large surfaces.
- Use earth-tone accents with restraint.
- Design for clarity first, then texture and mood.

### Don't

- Don't default to pure white backgrounds.
- Don't use cool blue-gray as the neutral base.
- Don't turn every major action into a loud accent button.
- Don't use overly geometric, sharp-cornered layouts.
- Don't add visible decorative texture everywhere.
- Don't make the system playful, bubbly, or toy-like.
- Don't drift into glossy luxury or cyber-futurist styling.

## 14. Prompt Guide

### Quick Prompt Language

Useful phrases when briefing design work:

- "warm editorial utility interface"
- "parchment background with low-contrast warm borders"
- "serif-led hierarchy with quiet sans utility text"
- "soft rounded controls with restrained accent use"
- "subtle cream gradients and atmospheric texture"
- "compact product density with editorial calm"

### Example Prompts

- "Design a landing page in a warm editorial utility style with a parchment background, serif hero headline, compact sans body copy, terracotta accent CTA, and softly elevated cream cards."
- "Create a settings panel using warm neutrals, small uppercase labels, quiet segmented controls, 24px card radii, and low-contrast dividers."
- "Build a launch slide with a Georgia-like serif headline, muted sans supporting text, ivory card surfaces, and a restrained terracotta accent."

## 15. One-Sentence Summary

Use this system when you want a design to feel **warm, editorial, tactile, and quietly useful**: a composed interface language built from serif-led emphasis, warm neutral surfaces, restrained earth-tone accents, soft containment, and subtle atmosphere.
