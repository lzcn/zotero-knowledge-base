import { exec, getAll, getOne, transaction } from "./db";
import { newZettelID } from "./zettel";
import type { NativeCardInput } from "./native-notes";

export interface NoteOperation {
  id: string;
  noteKey: string;
  libraryID: number;
  expectedHTML: string;
  intendedHTML: string;
  expectedVersion: number | null;
  input: NativeCardInput;
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
    typeof value.input.title !== "string" ||
    typeof value.input.body !== "string" ||
    (value.expectedVersion !== null &&
      !Number.isSafeInteger(value.expectedVersion))
  )
    throw new Error("Invalid Knowledge Base note save operation");
  return value;
}

/** Journal an in-progress cross-database save before changing the native note. */
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
    const prepared = {
      ...input,
      id: cardID,
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
        input: prepared,
      }),
    );
    await exec(
      "INSERT INTO note_save_operations (id, card_id, data, created_at) VALUES (?, ?, ?, ?)",
      [id, cardID, JSON.stringify(operation), Date.now()],
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

/** Call inside the same Knowledge Base transaction that commits the card and note mapping. */
export async function completeNoteOperation(
  operation: NoteOperation,
): Promise<void> {
  await exec("DELETE FROM note_save_operations WHERE id = ?", [operation.id]);
}

export async function abandonNoteOperation(
  operation: NoteOperation,
): Promise<void> {
  // A rejected native write changed neither database.
  await transaction(() =>
    exec("DELETE FROM note_save_operations WHERE id = ?", [operation.id]),
  );
}
