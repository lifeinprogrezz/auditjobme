

# Landing Page Improvements for Google OAuth Compliance

## Summary
Update the landing page to better satisfy Google OAuth verification while improving readability and trust signals. Changes span hero copy, showcase labels, sign-in section copy, nav behavior, section 04 text, and mobile responsiveness.

## Changes (single file: `src/components/LandingPage.tsx`)

### 1. Hero subtitle rewrite
Replace the fragmented subtitle with a flowing sentence:
> "Upload your CV and a job link — get a full strategic audit with research, proposals, and decision-maker contacts in 2 minutes."

Slightly increase font size to ~0.95rem and max-width to 560px for readability.

### 2. CTA smooth-scroll
Already working — `scrollToSignIn` is wired up. No change needed.

### 3. Nav "Sign in" button
Change `onClick` from `handleGoogleLogin` to `scrollToSignIn` so it keeps users on the page (Google compliance). The sign-in section at the bottom handles auth.

### 4. Showcase section labels
Add `exampleLabel` text above each screenshot card: "(Example audit output)" in muted 11px text. For sections 01-03, also add a "View full example →" link pointing to `https://auditjob.me/a/oberto-uintero1/vercel` opening in a new tab.

### 5. Section 04 ABOUT text
Change desc from "Why you. Not just what you did, but why it matters here." to "Who built this. Not just what they did, but why it matters here."

### 6. Social proof line
Add a line below section 04's description: "Built during an MBA at ESADE Business School. 500+ audits generated." — muted, small text (~12px, color #5a5750).

### 7. Sign-in section copy update
Update the privacy disclaimer from:
> "We only use your Google account to sign you in."

To:
> "We only use your Google account to sign you in. No email access, no data sharing."

### 8. Footer link visibility
Bump footer link color from `#9a9790` to `#b0ada8` for better contrast against dark background. Keep 11px size.

### 9. Mobile responsiveness
Add media query for screens under 640px:
- Reduce bottom fade on showcase images from 35% to 20% height
- Add a "See example audit →" link below each card for easy tap access
- The screenshots already go full-width; no structural change needed

### Technical notes
- All changes in one file: `src/components/LandingPage.tsx`
- No new assets, no routing changes, no backend changes
- The `showcaseItems` array gets two new optional fields: `exampleLabel` (string) and `link` (URL string)
- Social proof is hardcoded text below section 04, not a new data structure

