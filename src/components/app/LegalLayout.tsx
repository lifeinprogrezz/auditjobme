// Shared chrome for the public legal pages (/privacy, /terms) — issue #42. Token
// layer, no auth, no sign-out (these are readable signed-out). Warm voice, no
// em-dashes in the copy the pages pass in.
import { type ReactNode } from "react";
import { Link } from "react-router-dom";

export default function LegalLayout({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 max-w-2xl items-center gap-3 px-4 sm:px-6">
          <Link to="/" className="font-display text-sm font-semibold tracking-tight">
            auditjob.me
          </Link>
          <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
            Back to the map
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 pb-24 pt-10 sm:px-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: {updated}</p>
        <div className="mt-8 flex flex-col gap-8 leading-relaxed">{children}</div>
      </main>
    </div>
  );
}

export function LegalSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="border-l-2 border-border pl-4">
      <h2 className="text-base font-semibold text-foreground">{heading}</h2>
      <div className="mt-2 space-y-3 text-sm text-muted-foreground">{children}</div>
    </section>
  );
}
