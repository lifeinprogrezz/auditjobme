// Privacy policy (issue #42): real content on the token layer, product-accurate for
// the job-search product (not just the audit tool). Warm voice, no em-dashes.
import LegalLayout, { LegalSection } from "@/components/app/LegalLayout";
import { BRAND_NAME } from "@/lib/brand";

export default function Privacy() {
  return (
    <LegalLayout title="Privacy Policy" updated="12 July 2026">
      <p className="text-sm text-muted-foreground">
        {BRAND_NAME} helps Product Managers find and apply to jobs in Europe. This is a free product, and job hunting
        is private by design. Here's exactly what we hold and why.
      </p>

      <LegalSection heading="1. What we collect">
        <p>
          When you sign in with Google, we receive your name, email address, and profile picture, and use them only
          to identify your account. When you add your CV, we store the text you upload and the target roles and
          industries you pick. As you use the product we store the roles you mark applied and their status, and any
          tailored CV, cover letter, or company audit you generate.
        </p>
      </LegalSection>

      <LegalSection heading="2. How we use it">
        <p>
          We use your CV and profile to score how well each live role fits you, and to tailor a professional summary
          and cover letter when you ask for one. We never rewrite your CV body. The AI only writes the summary and the
          letter. We do not sell, rent, or share your personal information with third parties.
        </p>
      </LegalSection>

      <LegalSection heading="3. AI processing">
        <p>
          Scoring and tailoring run through our AI provider (Anthropic) on our own capped key. Your CV text and the
          job description are sent to generate that specific result. We don't use your data to train models, and the
          provider processes it only to return the result to you.
        </p>
      </LegalSection>

      <LegalSection heading="4. Where your data lives">
        <p>
          Your account, CV, and application data are stored in our EU-region cloud database with row-level security,
          so each account can only read its own data. Company audits you publish are reachable through their unique
          shareable links.
        </p>
      </LegalSection>

      <LegalSection heading="5. Fair-use limits">
        <p>
          Because AI runs on our budget, we use a lightweight device signal to keep free usage fair across everyone.
          We don't use third-party advertising cookies, and our product analytics are cookieless and can't identify
          you across visits.
        </p>
      </LegalSection>

      <LegalSection heading="6. Your rights">
        <p>
          You can ask us to delete your account and everything tied to it at any time. Just email us at{" "}
          <a href="mailto:hello@lifeinprogrezz.com" className="text-foreground underline underline-offset-2">
            hello@lifeinprogrezz.com
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection heading="7. Contact">
        <p>
          Any privacy question, reach us at{" "}
          <a href="mailto:hello@lifeinprogrezz.com" className="text-foreground underline underline-offset-2">
            hello@lifeinprogrezz.com
          </a>
          .
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
