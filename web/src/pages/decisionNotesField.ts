/** Board and Auditor see decision notes, and cannot type a new one. */
export function decisionNotesField(
  role: string | null | undefined,
  existingNotes: string | null | undefined,
): { editable: boolean; readOnlyNote: boolean; readOnlyText: string | null } {
  const readOnly = role === "board_member" || role === "auditor";
  const text = typeof existingNotes === "string" && existingNotes.trim() ? existingNotes : null;
  return {
    editable: !readOnly,
    readOnlyNote: readOnly,
    readOnlyText: readOnly ? text : null,
  };
}
