import { exec, getAll, getOne, transaction } from "./db";
import { newZettelID } from "./zettel";
import type { NativeCardInput } from "./native-notes";
import type { EditorDraft } from "./editor-drafts";

export interface NoteOperation {
  id: string;
  noteKey: string;
  libraryID: number;
  expectedHTML: string;
  intendedHTML: string;
  expectedVersion: number | null;
  input: EditorDraft;
}

function decode(data: string): NoteOperation {
  const value: NoteOperation = JSON.parse(data);
  if (
    !value ||
    typeof value.id !== "string" ||
    typeof value.noteKey !== "string" ||
    !Number.isSafeInteger(value.libraryID) ||
    typeof value.expectedHTML !== "string" ||
    typeof value.intendedHTML !== "string" ||
    !value.input ||
    typeof value.input.id !== "string" ||
    typeof value.input.draftId !== "string" ||
    !Number.isSafeInteger(value.input.draftRevision) ||
    typeof value.input.title !== "string" ||
    typeof value.input.body !== "string" ||
    (value.expectedVersion !== null &&
      !Number.isSafeInteger(value.expectedVersion))
  )
    throw new Error("Invalid Knowledge Base note save operation");
  return value;
}

/** Durably record intent and a recovery draft before touching Zotero's database. */
export async function prepareNoteOperation(
  input: NativeCardInput,
  note: Zotero.Item,
  intendedHTML: string,
  expectedVersion: number | null,
): Promise<NoteOperation> {
  return transaction(async () => {
    const id = `${note.libraryID}:${note.key}`;
    if (await getOne("SELECT id FROM note_save_operations WHERE id = ?", [id]))
      throw new Error("CARD_CONFLICT: an interrupted save requires recovery");
    const reserved = await getAll<{ id: string }>(
      "SELECT id FROM zettels UNION SELECT key AS id FROM note_keys UNION SELECT card_id AS id FROM note_save_operations",
    );
    const cardID =
      input.id || newZettelID(new Set(reserved.map((row) => row.id)));
    const draft: EditorDraft = {
      ...input,
      id: cardID,
      draftId: input.draftId ?? `note-save:${id}`,
      draftRevision: input.draftRevision ?? 0,
      expectedUpdatedAt: expectedVersion,
    };
    const operation = decode(
      JSON.stringify({
        id,
        noteKey: note.key,
        libraryID: note.libraryID,
        expectedHTML: input.expectedNoteHTML ?? note.getNote(),
        intendedHTML,
        expectedVersion,
        input: draft,
      }),
    );
    await exec(
      "INSERT INTO note_save_operations (id, card_id, data, created_at) VALUES (?, ?, ?, ?)",
      [id, cardID, JSON.stringify(operation), Date.now()],
    );
    await exec(
      `INSERT INTO editor_drafts (id, body, data, revision, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET body=excluded.body, data=excluded.data, revision=excluded.revision, updated_at=excluded.updated_at
      WHERE excluded.revision >= editor_drafts.revision`,
      [
        draft.draftId,
        draft.body,
        JSON.stringify({ ...draft, id: input.id }),
        draft.draftRevision,
        Date.now(),
      ],
    );
    return operation;
  });
}

export async function listNoteOperations(): Promise<NoteOperation[]> {
  return (
    await getAll<{ data: string }>(
      "SELECT data FROM note_save_operations ORDER BY created_at",
    )
  ).map((row) => decode(row.data));
}

/** Call inside the same KB transaction that commits the card and note mapping. */
export async function completeNoteOperation(
  operation: NoteOperation,
): Promise<void> {
  await exec("DELETE FROM note_save_operations WHERE id = ?", [operation.id]);
  await exec("DELETE FROM editor_drafts WHERE id = ? AND revision <= ?", [
    operation.input.draftId,
    operation.input.draftRevision,
  ]);
  const remaining = await getOne<{ data: string; revision: number }>(
    "SELECT data, revision FROM editor_drafts WHERE id = ?",
    [operation.input.draftId],
  );
  if (remaining) {
    const draft: EditorDraft = JSON.parse(remaining.data);
    if (
      draft.expectedUpdatedAt === operation.expectedVersion &&
      draft.noteID === operation.input.noteID &&
      (!draft.id || draft.id === operation.input.id)
    ) {
      const card = await getOne<{ updated_at: number }>(
        "SELECT updated_at FROM zettels WHERE id = ?",
        [operation.input.id],
      );
      if (card)
        await exec(
          "UPDATE editor_drafts SET data = ? WHERE id = ? AND revision = ?",
          [
            JSON.stringify({
              ...draft,
              id: operation.input.id,
              expectedUpdatedAt: card.updated_at,
              expectedNoteHTML: operation.intendedHTML,
            }),
            draft.draftId,
            remaining.revision,
          ],
        );
    }
  }
}

export async function abandonNoteOperation(
  operation: NoteOperation,
): Promise<void> {
  // A rejected native write changed neither database; retain the user's recovery draft.
  await transaction(() =>
    exec("DELETE FROM note_save_operations WHERE id = ?", [operation.id]),
  );
}
