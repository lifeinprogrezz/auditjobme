

# Landing Page Visual Overhaul

## Summary
Transform the landing page from a wireframe-like layout into a premium product showcase inspired by Linear/Stripe. The 3 uploaded audit screenshots become the centerpiece, displayed as large floating panels with perspective transforms and scroll-reveal animations.

## Assets
Copy the 3 uploaded screenshots into `src/assets/`:
- `audit-hero.png` (image-136: the full-viewport audit hero with diagnosis headline)
- `audit-research.png` (image-137: stats grid with $200M, 500M+, etc.)
- `audit-proposals.png` (image-138: Phase 1/2/3 proposal cards)

## Page Structure (5 sections)

### Section 1: Hero (full viewport height)
- Nav unchanged (AUDITJOB.ME left, Sign in right)
- "STOP APPLYING. START AUDITING." — tiny muted label, 10px uppercase
- Headline: "Land the job before the interview" — DM Sans, `clamp(2.8rem, 8vw, 5.2rem)`, weight 800
- Subtitle: single line, muted gray, generous margin below headline
- "Start free" CTA in sage accent, scrolls to sign-in
- Bottom of viewport: lots of empty dark space

### Section 2: Product Showcase (3 screenshots)
Each screenshot displayed as a large panel (max-width 960px, ~85% viewport width) with:
- `border-radius: 12px`
- Subtle `perspective` + `rotateX(2deg)` transform (like Linear)
- Edge gradient fade blending into dark background
- CSS scroll-driven reveal: scale 0.95→1.0, opacity 0.7→1.0 using `IntersectionObserver`

Above each screenshot, a label block:
1. "01 RESEARCH" + "Real company data. Sourced and verified."
2. "02 DIAGNOSIS" + "Problems identified. Impact quantified."
3. "03 PROPOSALS" + "Strategic solutions. Phased and actionable."

Labels use the same style as audit output section headers (12px uppercase muted, with description below).

Generous vertical spacing (120px+) between each screenshot block.

### Section 3: How It Works
Keep current 01/02/03 steps exactly as-is. Add more top padding to separate from showcase.

### Section 4: Sign In
Same content, slightly smaller heading to match step title size. More top spacing.

### Section 5: Footer
Unchanged.

## Technical Details

**File changes:** Only `src/components/LandingPage.tsx` + 3 new image assets.

**Scroll animation:** Use `IntersectionObserver` in a `useEffect` hook. Each showcase panel gets a ref, observer triggers a CSS class that transitions `transform` and `opacity`. No external animation library needed.

**Perspective effect:** Container gets `perspective: 1200px`, each image wrapper gets `transform: rotateX(2deg)` — subtle 3D tilt.

**Mobile:** Screenshots go full-width with 16px side padding. Headline drops to ~36px. Perspective transform reduced to 1deg. All sections stack vertically.

**No routing changes.** No backend changes. Only the landing page component and assets.

