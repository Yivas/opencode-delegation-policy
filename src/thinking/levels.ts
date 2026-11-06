// Shared with the terminal editor without importing provider tables or validation machinery.
export const THINKING_LEVELS = Object.freeze([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const);
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];
