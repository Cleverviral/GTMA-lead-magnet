// Check names whose `true` means "a fallback was used" (GTMA surfaces it; the page is fine).
// Every other check is pass/fail: `false` is the problem.
export const FLAG_CHECKS = new Set(['cta_fallback_used', 'default_palette_used']);

export const isFlagged = (name: string, value: boolean): boolean => (FLAG_CHECKS.has(name) ? value : !value);
