export const SWTagPolicy: {
  words(name: string): string[];
  key(name: string): string;
  excludedKeys(value: unknown): Set<string>;
  visible(names: string[], excluded: ReadonlySet<string>): string[];
};
