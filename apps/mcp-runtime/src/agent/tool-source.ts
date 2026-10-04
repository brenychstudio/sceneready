import { tool } from '@strands-agents/sdk';
import { z } from 'zod';

export const AI_TOOL_NAMES = [
  'read_production',
  'analyze_recovery',
  'simulate_option',
  'compose_explanation',
  'explain_risk',
] as const;

export type AiToolName = (typeof AI_TOOL_NAMES)[number];

const FORBIDDEN_AI_TOOLS = [
  'confirm_active_proposal',
  'execute_revision',
  'write_production_state',
] as const;

export interface ReadOnlyProductionFacts {
  readProduction(productionId: string): Promise<string>;
  analyzeRecovery(productionId: string): Promise<string>;
  simulateOption(optionId: string): Promise<string>;
  composeExplanation(productionId: string): Promise<string>;
  explainRisk(riskId: string): Promise<string>;
}

export function assertAiToolsHaveNoAuthority(names: readonly string[]): void {
  for (const name of names) {
    if ((FORBIDDEN_AI_TOOLS as readonly string[]).includes(name)) {
      throw new Error(`AI tool source rejected ${name}`);
    }
  }
}

export function createAiTools(facts: ReadOnlyProductionFacts) {
  const tools = [
    tool({
      name: 'read_production',
      description: 'Read one production snapshot. This does not change production.',
      inputSchema: z.object({ productionId: z.string().min(1) }),
      callback: (input) => facts.readProduction(input.productionId),
    }),
    tool({
      name: 'analyze_recovery',
      description: 'Analyze recorded recovery context. This does not apply a revision.',
      inputSchema: z.object({ productionId: z.string().min(1) }),
      callback: (input) => facts.analyzeRecovery(input.productionId),
    }),
    tool({
      name: 'simulate_option',
      description: 'Read a simulation result. This does not execute the option.',
      inputSchema: z.object({ optionId: z.string().min(1) }),
      callback: (input) => facts.simulateOption(input.optionId),
    }),
    tool({
      name: 'compose_explanation',
      description: 'Compose an explanation from recorded facts.',
      inputSchema: z.object({ productionId: z.string().min(1) }),
      callback: (input) => facts.composeExplanation(input.productionId),
    }),
    tool({
      name: 'explain_risk',
      description: 'Explain one recorded risk. This does not approve or deliver anything.',
      inputSchema: z.object({ riskId: z.string().min(1) }),
      callback: (input) => facts.explainRisk(input.riskId),
    }),
  ] as const;
  assertAiToolsHaveNoAuthority(tools.map((entry) => entry.name));
  return tools;
}
