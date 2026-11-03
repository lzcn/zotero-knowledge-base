export const SWStorage: {
  root(): string;
  notes(): string;
  assets(): string;
  cache(): string;
  prepareCache(active?: () => boolean): Promise<string>;
  searchCache(): string;
  model(): string;
  compiledModel(): string;
  prepareCompiledModel(active?: () => boolean): Promise<string>;
  runtime(): string;
};
