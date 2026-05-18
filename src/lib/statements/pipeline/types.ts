import type { Transaction, ParsePipelineDebug } from "../types";

export type PipelineResult = {
  transactions: Transaction[];
  debug: ParsePipelineDebug;
};