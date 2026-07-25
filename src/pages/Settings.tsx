// /settings — settings as a ROUTED page beside Today and Applications (Rober 7-25:
// promoted out of the map's ProfileModal popup so adding/removing preference
// surfaces has a proper home). The page is a thin wire: AppShell chrome + the
// shared useRolesData path feeding the pure SettingsPanel (pinned by its test).
import { useNavigate } from "react-router-dom";
import AppShell from "@/components/app/AppShell";
import SettingsPanel from "@/components/app/SettingsPanel";
import { useAuth } from "@/components/AuthProvider";
import { useRolesData } from "@/hooks/useRolesData";
import { useMemo } from "react";
import type { FilterOption } from "@/components/roles/FilterChip";

export default function Settings() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { jobs, cvText, profileMeta, profileChecked, saveTargets } = useRolesData();

  // Plain live-catalog sector counts (no facet cross-filtering here — the picker
  // wants the whole vocabulary, same contract the ProfileModal had).
  const sectorOptions = useMemo<FilterOption[]>(() => {
    const m = new Map<string, number>();
    for (const j of jobs) if (j.sector) m.set(j.sector, (m.get(j.sector) ?? 0) + 1);
    return [...m.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([value, count]) => ({ value, label: value, count }));
  }, [jobs]);

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
        targetSectors={profileMeta?.targetSectors ?? []}
        cvUpdatedAt={profileMeta?.cvUpdatedAt ?? null}
        // The CV-unlock flow lives on the map — deep-link it open rather than
        // rebuilding the parsed-upload modal on paper.
        onReplaceCv={() => navigate("/?cv=1")}
        sectorOptions={sectorOptions}
        onSaveTargets={saveTargets}
        email={user?.email ?? null}
      />
    </AppShell>
  );
}
