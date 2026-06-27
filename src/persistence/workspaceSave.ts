// Orchestrates saving both workspace artifacts (Markdown + Review).
// Each save is independent — a failure in one does not prevent the other.
export async function saveWorkspace(
  docDirty: boolean,
  reviewLoaded: boolean,
  reviewDirty: boolean,
  saveDoc: () => Promise<void>,
  saveReview: () => Promise<void>,
): Promise<void> {
  if (!docDirty && !(reviewLoaded && reviewDirty)) return;
  if (docDirty) await saveDoc();
  if (reviewLoaded && reviewDirty) await saveReview();
}
