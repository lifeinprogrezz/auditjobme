// /settings — settings as a ROUTED page beside Today and Applications (Rober 7-25:
// promoted out of the map's ProfileModal popup so adding/removing preference
// surfaces has a proper home). The page is a thin wire: AppShell chrome + the
// shared useRolesData path feeding the pure SettingsPanel (pinned by its test).
import { useNavigate } from "react-router";
import AppShell from "@/components/app/AppShell";
import ForwardingSection from "@/components/app/ForwardingSection";
import ReferralSection from "@/components/app/ReferralSection";
import SettingsPanel from "@/components/app/SettingsPanel";
import { useAuth } from "@/components/AuthProvider";
import { useRolesData } from "@/hooks/useRolesData";
import { useMemo } from "react";
import type { FilterOption } from "@/components/roles/FilterChip";
import { supabase } from "@/integrations/supabase/client";
import { pickableSectors, sectorLiquidity } from "@/lib/sectors";
import {
  buildAccountExport,
  accountExportFilename,
  accountExportText,
  type ExportClient,
} from "@/lib/account";

// The generated Database types make from()/select() generic over each table, so the
// per-table loop in buildAccountExport can't be typed against them without hard-coding
// every table twice. The lib declares the small structural slice it needs instead.
const exportClient = supabase as unknown as ExportClient;

/** Hand the assembled export to the browser as a download. */
function downloadJson(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function Settings() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const {
    jobs,
    cvText,
    profileMeta,
    profileChecked,
    saveTargets,
    dismissedJobs,
    toggleDismissed,
    connectionsCount,
    connectionsUpdatedAt,
    saveConnections,
    removeConnections,
  } = useRolesData();

  // Issue #84 — data export. Every row we hold for this account, read own-row through
  // RLS, assembled in the browser. A failed read throws rather than hand over a
  // partial file that claims to be everything.
  const handleExportData = async (): Promise<boolean> => {
    if (!user) return false;
    try {
      const now = new Date();
      const payload = await buildAccountExport(exportClient, {
        userId: user.id,
        email: user.email ?? null,
        now,
      });
      downloadJson(accountExportFilename(now), accountExportText(payload));
      return true;
    } catch (err) {
      console.error("account export failed", err);
      return false;
    }
  };

  // Issue #84 — account deletion. delete_own_account() (migration 20260726095000) is
  // the whole path: it removes the caller's auth.users row and every public table keyed
  // to them cascades. Stored audit files live in the audit-pdfs bucket, which the
  // database cascade cannot reach, so they go first through the Storage API (the user's
  // own delete policy covers their folder). That step is best effort: if it fails, the
  // function still clears the rows that make those objects reachable.
  const handleDeleteAccount = async (): Promise<boolean> => {
    if (!user) return false;
    try {
      const { data: files } = await supabase.storage.from("audit-pdfs").list(user.id);
      const paths = (files ?? []).map((f) => `${user.id}/${f.name}`);
      if (paths.length > 0) await supabase.storage.from("audit-pdfs").remove(paths);
    } catch (err) {
      console.error("could not clear stored audit files before deletion", err);
    }

    // Not in the generated types until the migration is applied to the project and
    // src/integrations/supabase/types.ts is regenerated.
    const rpc = supabase.rpc as unknown as (fn: string) => Promise<{ error: { message: string } | null }>;
    const { error } = await rpc("delete_own_account");
    if (error) {
      console.error("account deletion failed", error);
      return false;
    }
    await signOut();
    navigate("/");
    return true;
  };

  // Industries this user may PICK. No facet cross-filtering (the picker is about
  // the catalog, not the current view), but gated on live liquidity (issue #70):
  // this pick carries no visible count and is AND-ed into the paid scoring
  // prefilter, so offering an industry that cannot return roles costs the user
  // their whole score run. Already-stored picks are re-admitted even if they no
  // longer pass, so a saved target is never invisible and unclearable.
  const targetSectors = useMemo(() => profileMeta?.targetSectors ?? [], [profileMeta]);
  const sectorOptions = useMemo<FilterOption[]>(
    () => pickableSectors(sectorLiquidity(jobs), targetSectors),
    [jobs, targetSectors],
  );

  // HARD gate on the profile fetch (adversarial review 7-25, P1): the hook loads
  // profiles LAST in its chain, so an ungated render shows "No CV on file" +
  // unselected chips to a user who has both — and a chip touched during that
  // window seeds the edit state from empty defaults, which Save would then
  // persist over the stored targets. No panel until the truth is in memory.
  if (!profileChecked) {
    return (
      <AppShell title="Settings">
        <p className="mt-6 text-body text-muted-foreground" role="status">
          Loading your profile…
        </p>
      </AppShell>
    );
  }

  return (
    <AppShell title="Settings">
      <SettingsPanel
        cvText={cvText}
        targetRoles={profileMeta?.targetRoles ?? []}
        targetSectors={targetSectors}
        cvUpdatedAt={profileMeta?.cvUpdatedAt ?? null}
        // The CV-unlock flow lives on the map — deep-link it open rather than
        // rebuilding the parsed-upload modal on paper.
        onReplaceCv={() => navigate("/?cv=1")}
        sectorOptions={sectorOptions}
        onSaveTargets={saveTargets}
        email={user?.email ?? null}
        dismissedJobs={dismissedJobs}
        onRestoreDismissed={toggleDismissed}
        onExportData={handleExportData}
        onDeleteAccount={handleDeleteAccount}
        connectionsCount={connectionsCount}
        connectionsUpdatedAt={connectionsUpdatedAt}
        onSaveConnections={saveConnections}
        onRemoveConnections={removeConnections}
      />
      {/* Issue #75 — email auto-tracking (forwarding address). Self-contained
          section: owns its token read/create, so the pure SettingsPanel and its
          test stay untouched. */}
      <ForwardingSection />
      {/* Issue #78 — referral attribution: the invite link, nothing more (the
          reward half is blocked on #35). Self-contained like ForwardingSection,
          so the pure SettingsPanel and its test stay untouched. */}
      <ReferralSection />
    </AppShell>
  );
}
