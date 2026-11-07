interface TagExclusions {
  keys: Set<string>;
  patterns: RegExp[];
  colored: boolean;
  automatic: boolean;
}
export const SWTagPolicy: {
  words(name: string): string[];
  key(name: string): string;
  exclusions(value: unknown, coloredNames?: Iterable<string>): TagExclusions;
  excludes(name: string, rules: TagExclusions): boolean;
  visible(names: string[], rules: TagExclusions): string[];
};
