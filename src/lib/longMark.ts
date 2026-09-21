const longMarkInputs = new Set(Array.from("-－−‐‑‒–—―﹣ｰー"));

export function isLongMarkInput(value: string): boolean {
  return longMarkInputs.has(value);
}

export function matchesTrainingCharacter(actual: string, expected: string): boolean {
  return actual === expected || (expected === "ー" && isLongMarkInput(actual));
}
