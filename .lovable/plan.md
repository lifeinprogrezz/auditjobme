

# Landing Page Refinements

## Summary
Tighten the landing page into 3 flowing sections: Hero, Product Showcase (5 screenshots), and compact Sign-in. Remove the "How it works" section entirely and embed a process line into the sign-in area.

## Changes (single file: `src/components/LandingPage.tsx`)

### New assets needed
Copy 2 additional uploaded screenshots into `src/assets/`:
- `audit-opening.png` (Screenshot_from_2026-03-29_14-52-37.png — the hero/diagnosis page with bold headline)
- `audit-about.png` (Screenshot_from_2026-03-29_14-52-31.png — the "About" section with stats)

### 1. Top label
- Reduce to 11px, letter-spacing 0.2em, more muted color (~#6a6760)
- Reduce margin below from 2.2rem to 1rem so it connects to headline

### 2. Hero subtitle
- Change text to: "Full company audit in 2 minutes. Research, proposals, and contacts included."

### 3. CTA "Start free"
- Solid sage fill (#8a9a8a), dark text (#0f0e0c)
- Larger padding: 16px 40px
- Add hover effect: brightness increase + faint glow shadow via CSS class

### 4. Sign in button (nav)
- Border: lighter (~#5a5750), text: white (#f0ede8)

### 5. Product showcase — 5 screenshots
Update `showcaseItems` array to 5 items:
```
00 THE AUDIT / "This is what your application becomes." → audit-opening.png
01 RESEARCH / "Real company data. Sourced and verified." → audit-research.png (existing, was image-137)
02 DIAGNOSIS / "Problems identified. Impact quantified." → audit-hero.png (existing, was image-136 — the diagnosis screenshot)
03 PROPOSALS / "Strategic solutions. Phased and actionable." → audit-proposals.png (existing, was image-138)
04 ABOUT / "Your fit. Backed by proof." → audit-about.png
```

**Label style change**: Left-aligned within container. Number in sage, 24px bold. Thin 1px muted horizontal line extending from label text to right edge of container (using flexbox + `<hr>` or `border-bottom`).

**Tighter spacing**: Reduce gap between screenshots from 10rem to ~5rem (60-80px).

**Hover effect**: Add CSS transition on screenshot wrapper — `transform: scale(1.02)` and `filter: brightness(1.05)` on hover, 0.3s ease.

### 6. Remove "How it works" section
Delete the entire 3-column steps grid.

### 7. Sign-in section redesign
Replace with compact unit:
- Process line: "Upload your CV → Paste a job link → Get your audit" (13px, muted, arrows in sage)
- 16px gap
- "Try it free. No card required." at ~24px
- 8px gap
- "2 free audits to see the difference."
- 24px gap
- Google button
- 12px gap
- Privacy disclaimer
- Reduce section padding significantly (from 10rem to ~4rem top, ~3rem bottom)

### 8. Footer
- Increase font size to 13px

### 9. Existing showcase refs
- Update `useEffect` IntersectionObserver to handle 5 refs instead of 3

## Technical details
- Only `src/components/LandingPage.tsx` changes + 2 new image assets
- No routing, backend, or other component changes
- All hover effects via inline `<style>` block already present in the component

