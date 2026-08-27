// Saving a finished audit (issue #159) — lifted out of AuditGenerator.jsx so the
// Apply page saves one exactly the way the generator always has.
//
// The contract that matters is the privacy one (issue #90): a saved audit is
// PRIVATE. is_published stays false, and only the owner's explicit Publish
// control on the generator page ever flips it. The Apply page has no publish
// flow at all, so an audit it saves can only ever be read by the person who ran
// it, whatever anybody guesses about the link.
import { supabase } from "@/integrations/supabase/client";
import { getPublicAuditOwner } from "@/components/audit/utils.js";
import { generatePDFHTML } from "@/components/audit/pdfHtml.js";
import type { Json } from "@/integrations/supabase/types";
import type { AuditData } from "./runAudit";

export type SaveAuditInput = {
  userId: string;
  /** The signed-in user, for the owner slug on the (still private) share path. */
  user: { email?: string | null; user_metadata?: Record<string, unknown> } | null;
  auditData: AuditData;
  jobLink: string;
  /** Anti-abuse device id, when the caller has one. */
  deviceFingerprint?: string | null;
  durationSeconds?: number | null;
};

export type SavedAudit = {
  auditId: string | null;
  slug: string;
  ownerSlug: string;
};

/** Save the audit and its rendered page. Returns null if the write failed, so the
 *  caller can still hand the user their PDF and say the copy did not save. */
export async function saveAuditPrivate(input: SaveAuditInput): Promise<SavedAudit | null> {
  const { userId, user, auditData, jobLink, deviceFingerprint, durationSeconds } = input;
  try {
    const company = (auditData.company || {}) as { company?: string; role?: string };
    const { data: slugData } = await supabase.rpc("generate_audit_slug", {
      p_user_id: userId,
      p_company: company.company || "audit",
    });
    const slug = slugData || (company.company || "audit").replace(/[^a-zA-Z0-9]/g, "-").toLowerCase();

    const { data: profile } = await supabase
      .from("profiles")
      .select("username, display_name")
      .eq("id", userId)
      .maybeSingle();
    const ownerSlug: string = getPublicAuditOwner(user, profile);

    const pdfHtml = generatePDFHTML(auditData);
    const blob = new Blob([pdfHtml], { type: "text/html" });
    const fileName = `${userId}/${slug}.html`;
    const { error: uploadError } = await supabase.storage
      .from("audit-pdfs")
      .upload(fileName, blob, { contentType: "text/html", upsert: true });
    const pdfPath = uploadError ? null : fileName;

    const roleCtx = (auditData.roleCtx || {}) as { audit_label?: string };
    const { data: auditRow } = await supabase
      .from("audits")
      .insert({
        user_id: userId,
        company_name: company.company || "Unknown",
        role_name: company.role || "",
        audit_label: roleCtx.audit_label || "Product Audit",
        accent_color: auditData.accent || "#8a9a8a",
        job_link: jobLink,
        audit_data: auditData as unknown as Json,
        pdf_path: pdfPath,
        slug,
        is_published: false,
        duration_seconds: durationSeconds ?? null,
      })
      .select("id")
      .single();

    if (auditRow?.id && deviceFingerprint) {
      await supabase.from("device_fingerprints").insert({
        fingerprint_id: deviceFingerprint,
        user_id: userId,
        audit_id: auditRow.id,
      });
    }

    return { auditId: auditRow?.id || null, slug, ownerSlug };
  } catch (err) {
    console.error("Failed to save audit:", err);
    return null;
  }
}
