import type { CompanionArtifact, CompanionSaveResult } from "./companionArtifact";

/**
 * Orchestrates saving a document bundle: the markdown document plus every
 * dirty, loaded companion sidecar (review, traceability, future ones).
 *
 * Each step is independently isolated — a failure in the document save does
 * NOT skip companion saves, and a failure in one companion does not skip the
 * next. This is a deliberate change from the previous saveWorkspace(), which
 * aborted every later step as soon as any earlier `await` threw. See
 * docs/document-bundle-save-design.md §0.1 / §8.
 */
export async function saveBundle(
  saveDoc: () => Promise<void>,
  docDirty: boolean,
  companions: CompanionArtifact[],
): Promise<{ doc: "saved" | "skipped" | "failed"; companions: CompanionSaveResult[] }> {
  let doc: "saved" | "skipped" | "failed" = "skipped";
  if (docDirty) {
    try {
      await saveDoc();
      doc = "saved";
    } catch (e) {
      doc = "failed";
      console.error("[saveBundle] document save failed", e);
    }
  }

  const results: CompanionSaveResult[] = [];
  for (const companion of companions) {
    if (!companion.isLoaded() || !companion.isDirty()) {
      results.push({ id: companion.id, status: "skipped" });
      continue;
    }
    try {
      await companion.save();
      // Still dirty after save() resolved means it didn't actually complete
      // (a caught-and-toasted internal failure, or a cancelled Save-As
      // picker) — companion.save() is expected not to throw in that case,
      // so this is the primary success/failure signal, not the try/catch.
      results.push({ id: companion.id, status: companion.isDirty() ? "unsaved" : "saved" });
    } catch (e) {
      // Belt-and-suspenders: if a companion implementation ever does throw,
      // it must not prevent the remaining companions from being attempted.
      results.push({ id: companion.id, status: "failed", error: (e as Error).message });
    }
  }
  return { doc, companions: results };
}
