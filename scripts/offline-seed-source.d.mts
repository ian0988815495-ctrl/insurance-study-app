export type SeedQuestion = {
  options: Array<{ id: string }>;
  aiExplanation?: { status?: string; content?: string | null };
  aiOptionAnalysis?: Array<{ content?: string | null }>;
};

export type OfflineSeed = { questions: SeedQuestion[] };

export function readSeed(path: string): OfflineSeed;
export function hasCompleteAiExplanations(seed: OfflineSeed, expectedQuestionCount: number): boolean;
export function selectOfflineSeedSource(basePath: string, enrichedPath: string): { path: string; seed: OfflineSeed; enriched: boolean };
