import { describe, expect, it } from "vitest";
import { LEGAL_DOCUMENTS, LEGAL_VERSION, PRIVACY_NOTICE, TERMS_OF_USE } from "./legal.ts";

describe("privacy notice and terms", () => {
  it("are complete enough to show", () => {
    for (const doc of Object.values(LEGAL_DOCUMENTS)) {
      expect(doc.sections.length).toBeGreaterThan(3);
      for (const section of doc.sections) {
        expect(section.heading.trim()).not.toBe("");
        expect(section.paragraphs.length).toBeGreaterThan(0);
        for (const paragraph of section.paragraphs) expect(paragraph.trim()).not.toBe("");
      }
    }
  });

  it("change the accepted version whenever either one changes", () => {
    expect(LEGAL_VERSION).toContain(PRIVACY_NOTICE.version);
    expect(LEGAL_VERSION).toContain(TERMS_OF_USE.version);
  });

  it("say they are drafts until a lawyer approves them", () => {
    // Flip `draft` only together with the lawyer's approved wording.
    expect(PRIVACY_NOTICE.draft).toBe(true);
    expect(TERMS_OF_USE.draft).toBe(true);
  });
});
