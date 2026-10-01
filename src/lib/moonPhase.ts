// 月相の計算と、フッターの小さな月アイコン用の SVG パス。平均朔望月で近似する（誤差は ±半日ほど。アイコンには十分）。

const SYNODIC_DAYS = 29.530588853;
const DAY_MS = 86_400_000;
/** 2000-01-06 18:14 UTC の新月を基準にする */
const REFERENCE_NEW_MOON_MS = Date.UTC(2000, 0, 6, 18, 14);

const wrap = (phase: number) => {
  const wrapped = phase % 1;
  return wrapped < 0 ? (wrapped + 1) % 1 : wrapped;
};

/** 月相。0 = 新月、0.25 = 上弦、0.5 = 満月、0.75 = 下弦（[0, 1)） */
export function moonPhase(date: Date): number {
  return wrap((date.getTime() - REFERENCE_NEW_MOON_MS) / DAY_MS / SYNODIC_DAYS);
}

// 8 等分した月の呼び名。新月・上弦・満月・下弦の間を、昔ながらの呼び名で埋める
const PHASE_NAMES = ["新月", "三日月", "上弦", "十三夜", "満月", "寝待月", "下弦", "有明月"] as const;

export function moonPhaseName(phase: number): string {
  return PHASE_NAMES[Math.round(wrap(phase) * 8) % 8]!;
}

const round = (value: number) => String(+value.toFixed(2));

/**
 * 月の明るい側だけの SVG パス（半径 r、(0,0)〜(2r,2r) の箱）。新月は "" （何も光らない）。
 * 満ちていくあいだは右側、欠けていくあいだは左側が光る（北半球から見た向き）。
 */
export function moonPhasePath(phase: number, r: number): string {
  const p = wrap(phase);
  const waxing = p <= 0.5;
  const folded = waxing ? p : 1 - p; // 0（新月）〜 0.5（満月）
  const k = Math.cos(2 * Math.PI * folded); // 1: 新月 … 0: 半月 … -1: 満月
  if (k > 0.9995) return "";
  const limb = waxing ? 1 : 0; // 明るい側の輪郭（右 / 左）
  const terminator = folded <= 0.25 ? 1 - limb : limb; // 三日月は明るい側へ、凸月は暗い側へ膨らむ
  const rx = round(r * Math.abs(k));
  return `M${round(r)} 0A${round(r)} ${round(r)} 0 0 ${limb} ${round(r)} ${round(2 * r)}A${rx} ${round(r)} 0 0 ${terminator} ${round(r)} 0Z`;
}
