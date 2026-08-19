// Terms of service (issue #42): real content on the token layer, product-accurate for
// the job-search product. Warm voice, no em-dashes.
import LegalLayout, { LegalSection } from "@/components/app/LegalLayout";
import { BRAND_NAME } from "@/lib/brand";

export default function Terms() {
  return (
    <LegalLayout title="Terms of Service" updated="12 July 2026">
      <p className="text-sm text-muted-foreground">
        These terms cover your use of {BRAND_NAME}. Using the product means you agree to them. If you don't, please
        don't use it.
      </p>

      <LegalSection heading="1. What the product does">
        <p>
          {BRAND_NAME} is a free tool for Product Managers job-hunting in Europe. It shows a daily-scraped pool of live
          roles, scores each against your CV, and helps you prepare an application bundle: a tailored CV summary, a
          cover letter, and an optional company audit. It also tracks the roles you apply to.
        </p>
      </LegalSection>

      <LegalSection heading="2. Your account">
        <p>
          You sign in with Google. You're responsible for keeping your account secure, and for the accuracy of the CV
          and details you add. Don't share your account or use someone else's.
        </p>
      </LegalSection>

      <LegalSection heading="3. Free use and fair limits">
        <p>
          The product is free, with fair-use limits so the AI features stay sustainable for everyone. We may adjust
          those limits over time. There's no hidden paywall.
        </p>
      </LegalSection>

      <LegalSection heading="4. We prepare, you submit">
        <p>
          We generate application materials and prefill what we can, but you always review and submit the application
          yourself on the employer's own site. We never submit an application on your behalf.
        </p>
      </LegalSection>

      <LegalSection heading="5. Your content">
        <p>
          You keep ownership of what you provide, including your CV and the roles you track. The CV summaries, cover
          letters, and audits you generate are yours to use and send.
        </p>
      </LegalSection>

      <LegalSection heading="6. Privacy of your job hunt">
        <p>
          Your job search is private by default. Nothing you do is public unless you choose it. A company audit is
          private until you publish a shareable link, and publishing is an explicit, per-audit action. When you
          publish one, anyone with the link can see that audit and your public display name, never your email.
        </p>
      </LegalSection>

      <LegalSection heading="7. Fair use of the service">
        <p>
          Don't use the product for anything unlawful, to harass anyone, or to submit misleading or fraudulent
          information. We may suspend accounts that abuse the service.
        </p>
      </LegalSection>

      <LegalSection heading="8. No warranty">
        <p>
          The product is provided as is. Scores and generated materials are aids, not guarantees. You decide what to
          send and where to apply, and those decisions are yours.
        </p>
      </LegalSection>

      <LegalSection heading="9. Changes">
        <p>
          We may update these terms as the product evolves. Continuing to use it after a change means you accept the
          update.
        </p>
      </LegalSection>

      <LegalSection heading="10. Contact">
        <p>
          Questions? Reach us at{" "}
          <a href="mailto:hello@lifeinprogrezz.com" className="text-foreground underline underline-offset-2">
            hello@lifeinprogrezz.com
          </a>
          .
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
