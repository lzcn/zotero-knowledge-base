export const NOTE_TYPES = [
  "literature",
  "zettel",
  "thinking",
  "entity",
] as const;

export type NoteType = (typeof NOTE_TYPES)[number];

export function requireNoteType(value: unknown): NoteType {
  if (!NOTE_TYPES.includes(value as NoteType))
    throw new Error("Invalid note type");
  return value as NoteType;
}
