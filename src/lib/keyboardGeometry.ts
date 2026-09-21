export type KeyboardGeometry = "staggered" | "grid" | "split";

export function readGeometry(value: string | null): KeyboardGeometry {
  return value === "grid" || value === "split" ? value : "staggered";
}

export function keyboardOffset(geometry: KeyboardGeometry, row: number, column: number, pitch: number): number {
  if (geometry === "split") return column >= 5 ? pitch : 0;
  return geometry === "staggered" ? ([0, .25, .75][row] ?? 0) * pitch : 0;
}

export function keyboardWidth(geometry: KeyboardGeometry, pitch: number): number {
  return (geometry === "split" ? 11 : geometry === "staggered" ? 10.75 : 10) * pitch + 8;
}
