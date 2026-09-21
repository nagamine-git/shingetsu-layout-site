import {
  growthSeries,
  progressMilestones,
  weeklyActivity,
} from "./trainingProgress";
import {
  median,
  type TrainingMethod,
  type TrainingProfile,
  type TrainingResult,
} from "./training";

const modeNames = {
  learn: "習得",
  review: "復習",
  speed: "高速化",
  benchmark: "定点測定",
  ime: "IME実践",
  focus: "集中",
};
const namespace = "http://www.w3.org/2000/svg";

function node<Tag extends keyof SVGElementTagNameMap>(
  tag: Tag,
  attributes: Record<string, string>,
  text = "",
): SVGElementTagNameMap[Tag] {
  const item = document.createElementNS(namespace, tag);
  for (const [name, value] of Object.entries(attributes))
    item.setAttribute(name, value);
  item.textContent = text;
  return item;
}

function required<ElementType extends HTMLElement = HTMLElement>(
  id: string,
): ElementType {
  const item = document.getElementById(id);
  if (!item) throw new Error(`Missing progress element: ${id}`);
  return item as ElementType;
}

function conditionLabel(result: TrainingResult): string {
  const fixedDuration = Number(result.signature.split(":")[2]);
  return `${modeNames[result.mode]} · ${fixedDuration ? `${fixedDuration}秒` : `段階${result.stage + 1}`} · ${result.material === "paragraph" ? "文章" : "短文"}${result.method !== "touch" && !result.signature.endsWith(":longmark-v1") ? " · 旧入力規則" : ""}`;
}

export class TrainingProgressView {
  private condition = required<HTMLSelectElement>("lab-growth-condition");
  private period = required<HTMLSelectElement>("lab-growth-period");
  private goal = required<HTMLSelectElement>("lab-week-goal");
  private current = "";

  constructor(
    private context: () => {
      profile: TrainingProfile;
      method: TrainingMethod;
      signature: string;
    },
  ) {
    try {
      const saved = localStorage.getItem("shingetsu-week-goal-v1");
      if (saved && ["2", "3", "5", "7"].includes(saved))
        this.goal.value = saved;
    } catch {}
    this.condition.addEventListener("change", (): void => this.render());
    this.period.addEventListener("change", (): void => this.render());
    matchMedia("(max-width: 700px)").addEventListener("change", (): void =>
      this.render(),
    );
    this.goal.addEventListener("change", (): void => {
      try {
        localStorage.setItem("shingetsu-week-goal-v1", this.goal.value);
      } catch {}
      this.render();
    });
  }

  render(): void {
    const { profile, method, signature } = this.context();
    const results = profile.results.filter(
      (result): boolean => result.method === method,
    );
    const groups = new Map<string, TrainingResult>();
    for (const result of [...results].sort(
      (left, right): number => Date.parse(left.date) - Date.parse(right.date),
    ))
      groups.set(result.signature, result);
    const selected =
      this.current === signature ? this.condition.value : signature;
    this.current = signature;
    this.condition.replaceChildren();
    for (const [key, result] of [...groups].reverse())
      this.condition.add(new Option(conditionLabel(result), key));
    this.condition.disabled = groups.size === 0;
    if (!groups.size)
      this.condition.add(new Option("練習後に条件を選べます", signature));
    if (groups.has(selected)) this.condition.value = selected;
    const points = growthSeries(
      results,
      this.condition.value,
      Number(this.period.value) as 0 | 7 | 30,
    );
    const eligible = points.filter((point): boolean => point.eligible);
    const speedLabel = method === "ime" ? "文字" : "かな";
    required("lab-growth-speed-label").textContent =
      `入力速度 · ${speedLabel} / 分`;
    required("lab-growth-accuracy-label").textContent =
      method === "ime" ? "確定文の一致率 · %" : "打鍵正確率 · %";
    const currentMedian =
      eligible.length >= 5
        ? median(eligible.slice(-5).map((point): number => point.result.cpm))
        : null;
    required("lab-growth-summary").textContent = points.length
      ? `${points.length}回の記録 · 比較可能 ${eligible.length}回${currentMedian === null ? " · 比較可能な5回が揃うと中央値を表示します。" : ` · 直近5回の中央値 ${Math.round(currentMedian)}${speedLabel}/分`}`
      : "この期間には記録がありません。短い練習から、最初の一点を。";
    const firstDate = points.length ? Date.parse(points[0].result.date) : 0;
    const lastDate = points.length
      ? Date.parse(points[points.length - 1].result.date)
      : firstDate;
    const width = matchMedia("(max-width: 700px)").matches ? 400 : 640;
    const edge = width - 30;
    const horizontal = (date: string): number =>
      lastDate === firstDate
        ? width / 2
        : 45 +
          ((Date.parse(date) - firstDate) / (lastDate - firstDate)) *
            (edge - 45);
    for (const metric of ["speed", "accuracy"] as const) {
      const svg = document.getElementById(`lab-growth-${metric}`);
      if (!svg) continue;
      svg.setAttribute("viewBox", `0 0 ${width} 180`);
      svg.replaceChildren();
      const maximum =
        metric === "accuracy"
          ? 100
          : Math.max(
              20,
              Math.ceil(
                Math.max(
                  0,
                  ...points.map((point): number => point.result.cpm),
                ) / 20,
              ) * 20,
            );
      svg.append(
        node("path", {
          d: `M45 20V140H${edge} M45 80H${edge}`,
          class: "lab-chart-grid",
        }),
        node("text", { x: "4", y: "24" }, String(maximum)),
        node("text", { x: "24", y: "144" }, "0"),
      );
      let trend = "";
      for (const point of points) {
        const horizontalPosition = horizontal(point.result.date);
        const value =
          metric === "speed" ? point.result.cpm : point.result.accuracy;
        const verticalPosition = 140 - (value / maximum) * 120;
        const marker = point.eligible
          ? node("circle", {
              cx: String(horizontalPosition),
              cy: String(verticalPosition),
              r: "3.5",
              class: "lab-growth-dot",
            })
          : node("path", {
              d: `M${horizontalPosition} ${verticalPosition - 4}l4 4-4 4-4-4Z`,
              class: "lab-growth-excluded",
            });
        marker.append(
          node(
            "title",
            {},
            `${new Date(point.result.date).toLocaleString("ja-JP")} · ${value.toFixed(1)}${metric === "accuracy" ? "%" : `${speedLabel}/分`}${point.eligible ? "" : " · 比較対象外"}`,
          ),
        );
        svg.append(marker);
        if (metric === "speed" && point.median !== null)
          trend += `${trend ? " L" : "M"}${horizontalPosition} ${140 - (point.median / maximum) * 120}`;
      }
      if (trend)
        svg.append(node("path", { d: trend, class: "lab-growth-trend" }));
      if (points.length) {
        const dateLabel = (date: number): string =>
          new Date(date).toLocaleString("ja-JP", {
            month: "numeric",
            day: "numeric",
            ...(lastDate - firstDate < 86_400_000
              ? ({ hour: "2-digit", minute: "2-digit" } as const)
              : {}),
          });
        svg.append(
          node("text", { x: "45", y: "167" }, dateLabel(firstDate)),
          node(
            "text",
            { x: String(edge), y: "167", "text-anchor": "end" },
            dateLabel(lastDate),
          ),
        );
      }
    }
    const table = required("lab-growth-table");
    table.replaceChildren();
    for (const point of [...points].reverse()) {
      const row = document.createElement("tr");
      for (const value of [
        new Date(point.result.date).toLocaleString("ja-JP"),
        `${Math.round(point.result.cpm)}${speedLabel}/分`,
        `${point.result.accuracy.toFixed(1)}%`,
        point.median === null
          ? "—"
          : `${Math.round(point.median)}${speedLabel}/分`,
        point.eligible
          ? "対象"
          : "対象外（中断・ガイド・正確率・時間・文字数）",
      ]) {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.append(cell);
      }
      table.append(row);
    }
    const week = weeklyActivity(results);
    required("lab-week-count").textContent =
      `${week.days} / ${this.goal.value} 日 · ${week.sessions}回 · ${Math.floor(week.seconds / 60)}分`;
    const progress = required<HTMLProgressElement>("lab-week-progress");
    progress.max = Number(this.goal.value);
    progress.value = Math.min(week.days, progress.max);
    const skills = method === "ime" ? {} : profile[method];
    const due = Object.entries(skills).filter(
      ([kana, skill]): boolean => kana.length === 1 && skill.due <= Date.now(),
    ).length;
    required("lab-quest-text").textContent =
      method === "ime"
        ? "実入力を1セット。速さだけでなく、変換後の一致率も振り返ろう。"
        : due
          ? `${due}文字が復習の時期。ことばの中で、ヒントなしで一度思い出そう。`
          : "短い文を1セット。迷った文字を見つけて、次の復習につなげよう。";
    required<HTMLButtonElement>("lab-quest-start").textContent =
      method === "ime" ? "IME実践を始める →" : "ことばで復習する →";
    const list = required("lab-milestones");
    list.replaceChildren();
    for (const milestone of progressMilestones(results)) {
      const item = document.createElement("li");
      item.dataset.earned = String(milestone.earned);
      const title = document.createElement("strong");
      title.textContent = `${milestone.earned ? "●" : "○"} ${milestone.title}`;
      const description = document.createElement("span");
      description.textContent = milestone.description;
      item.append(title, description);
      list.append(item);
    }
  }
}
