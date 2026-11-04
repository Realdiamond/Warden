// The public privacy notice and terms of use at /privacy and /terms (M11). The Play Store needs a
// privacy policy address; the words come from packages/shared, the same as in the app.

import { LEGAL_DOCUMENTS } from "@warden/shared";

export function LegalPage({ doc }: { doc: keyof typeof LEGAL_DOCUMENTS }) {
  const document = LEGAL_DOCUMENTS[doc];
  const other = doc === "privacy" ? LEGAL_DOCUMENTS.terms : LEGAL_DOCUMENTS.privacy;
  return (
    <main className="legal">
      <p className="legal-brand">Warden</p>
      <h1>{document.title}</h1>
      {document.draft && (
        <p className="legal-draft" role="note">
          Draft: this text has not yet been checked by a lawyer and may change before Warden
          launches.
        </p>
      )}
      {document.sections.map((section) => (
        <section key={section.heading}>
          <h2>{section.heading}</h2>
          {section.paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </section>
      ))}
      <p className="legal-meta">
        Version {document.version} · <a href={`/${other.id}`}>{other.title}</a>
      </p>
    </main>
  );
}
