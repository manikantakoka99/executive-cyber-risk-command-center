import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decisionNotesField } from "./src/pages/decisionNotesField.ts";

describe("decision notes for read-only roles", () => {
  it("hides the editor for Board and Auditor and keeps existing notes as text", () => {
    for (const role of ["board_member", "auditor"] as const) {
      const empty = decisionNotesField(role, null);
      assert.equal(empty.editable, false);
      assert.equal(empty.readOnlyNote, true);
      assert.equal(empty.readOnlyText, null);

      const saved = decisionNotesField(role, "  Recorded by CxO  ");
      assert.equal(saved.editable, false);
      assert.equal(saved.readOnlyNote, true);
      assert.equal(saved.readOnlyText, "  Recorded by CxO  ");
    }
  });

  it("keeps the textarea for roles that can record a note", () => {
    for (const role of ["cxo", "ciso", "program_office", "admin"]) {
      const field = decisionNotesField(role, "Already recorded");
      assert.equal(field.editable, true);
      assert.equal(field.readOnlyNote, false);
      assert.equal(field.readOnlyText, null);
    }
  });
});
