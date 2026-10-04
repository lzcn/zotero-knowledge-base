import { exec, getAll, getOne, transaction } from "./db";
import type { NativeCardInput } from "./native-notes";

export interface EditorDraft extends NativeCardInput {
  draftId: string;
  draftRevision: number;
  nativeDocument?: boolean;
}

function decode(data: string): EditorDraft {
  const value = JSON.parse(data);
  if (
    !value ||
    typeof value.draftId !== "string" ||
    typeof value.title !== "string" ||
    typeof value.body !== "string" ||
    !Number.isSafeInteger(value.draftRevision)
  ) {
    throw new Error("Invalid Knowledge Base editor draft");
  }
  return value;
}

export async function saveEditorDraft(input: EditorDraft): Promise<void> {
  const data = JSON.stringify(input);
  decode(data);
  await transaction(() =>
    exec(
      `INSERT INTO editor_drafts (id, body, data, revision, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET body = excluded.body, data = excluded.data,
     revision = excluded.revision, updated_at = excluded.updated_at
     WHERE excluded.revision >= editor_drafts.revision`,
      [input.draftId, input.body, data, input.draftRevision, Date.now()],
    ),
  );
}

export async function getEditorDraft(id: string): Promise<EditorDraft | null> {
  const row = await getOne<{ data: string }>(
    "SELECT data FROM editor_drafts WHERE id = ?",
    [id],
  );
  return row ? decode(row.data) : null;
}

export async function listEditorDrafts(): Promise<EditorDraft[]> {
  const rows = await getAll<{ data: string }>(
    "SELECT data FROM editor_drafts ORDER BY updated_at DESC",
  );
  return rows
    .map((row) => decode(row.data))
    .filter((draft) => !draft.nativeDocument);
}

export async function discardEditorDraft(id: string): Promise<void> {
  await transaction(() => exec("DELETE FROM editor_drafts WHERE id = ?", [id]));
}
