import { LunarRenderer } from "./lunarRenderer";

const stage = document.querySelector<HTMLElement>(".hero-art");
const moon = document.querySelector<HTMLElement>(".eclipse");
const canvas = document.querySelector<HTMLCanvasElement>(".lunar-canvas");
const replayButton = document.querySelector<HTMLButtonElement>(".moon-replay");
const phaseShadow = document.querySelector<SVGElement>(".eclipse-phase-shadow");
const exposureLayer = document.querySelector<HTMLElement>(".hero-flash");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const moonAnimations: Animation[] = [];
let screenImpact: Animation | undefined;
let renderer: LunarRenderer | undefined;
let attempted = false;
let elapsed = 0;
let previous: number | undefined;
let request = 0;
let ready = false;
let visible = false;
let manual = false;
let paused = false;
let completed = false;

// 遮蔽円の進行。終端速度を残した曲線で、6.4 秒ちょうどに最後の光条が消える。
// SVG 側の WAAPI easing (coverEasing) と同じ制御点を使う。
const coverCurve = [0.45, 0, 0.75, 0.8] as const;
const coverEasing = `cubic-bezier(${coverCurve.join(",")})`;

function easedCover(progress: number): number {
  if (progress >= 1) return 1;
  if (progress <= 0) return 0;
  const [x1, y1, x2, y2] = coverCurve;
  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 16; iteration += 1) {
    const middle = (low + high) / 2;
    const inverse = 1 - middle;
    const position =
      3 * inverse * inverse * middle * x1 +
      3 * inverse * middle * middle * x2 +
      middle ** 3;
    if (position < progress) low = middle;
    else high = middle;
  }
  const parameter = (low + high) / 2;
  const inverse = 1 - parameter;
  return (
    3 * inverse * inverse * parameter * y1 +
    3 * inverse * parameter * parameter * y2 +
    parameter ** 3
  );
}

// 露光レイヤーが月の輪郭を基点に光れるよう、月の位置をCSS変数で渡す（モバイル構図用）。
function measure(): void {
  const disc = document.querySelector<HTMLElement>(".eclipse-disc");
  const hero = exposureLayer?.parentElement;
  if (!disc || !hero || !exposureLayer) return;
  const bounds = disc.getBoundingClientRect();
  const origin = hero.getBoundingClientRect();
  const radius = bounds.width / 2;
  exposureLayer.style.setProperty("--moon-cx", `${Math.round(bounds.left - origin.left + radius)}px`);
  exposureLayer.style.setProperty("--moon-cy", `${Math.round(bounds.top - origin.top + radius)}px`);
  exposureLayer.style.setProperty("--moon-r", `${Math.round(radius)}px`);
}

function fallback(): void {
  moon?.removeAttribute("data-renderer");
  renderer?.dispose();
  renderer = undefined;
}

function draw(): void {
  for (const animation of moonAnimations) {
    animation.currentTime =
      reducedMotion.matches && animation !== moonAnimations[0] ? 0 : elapsed;
  }
  if (screenImpact && !playing()) screenImpact.currentTime = 0;
  if (canvas && !attempted && !reducedMotion.matches) {
    attempted = true;
    renderer = LunarRenderer.create(canvas, fallback);
  }
  if (
    renderer?.draw({
      seconds: elapsed / 1000,
      cover: easedCover(elapsed / 6400),
      quiet: reducedMotion.matches,
    })
  ) {
    moon?.setAttribute("data-renderer", "webgl");
  }
  if (stage) stage.dataset.elapsed = String(Math.round(elapsed));
}

function playing(): boolean {
  return (
    ready &&
    visible &&
    !document.hidden &&
    !paused &&
    !completed &&
    (!reducedMotion.matches || manual)
  );
}

function tick(timestamp: number): void {
  request = 0;
  if (!playing()) {
    previous = undefined;
    return;
  }
  const interval = previous === undefined ? 0 : timestamp - previous;
  previous = timestamp;
  elapsed = Math.min(8000, elapsed + interval);
  renderer?.sample(interval);
  draw();
  if (elapsed >= 8000) {
    completed = true;
    update();
  } else request = requestAnimationFrame(tick);
}

function update(): void {
  if (request) cancelAnimationFrame(request);
  request = 0;
  previous = undefined;
  const active = playing();
  if (exposureLayer) exposureLayer.hidden = !active;
  if (active) request = requestAnimationFrame(tick);
  else if (screenImpact) screenImpact.currentTime = 0;
  if (stage)
    stage.dataset.state = completed
      ? "complete"
      : active
        ? "playing"
        : "paused";
  if (replayButton) {
    replayButton.textContent = completed
      ? "↻ もう一度見る"
      : ready && !paused && (!reducedMotion.matches || manual)
        ? "Ⅱ 動きを止める"
        : "▷ 月を動かす";
    replayButton.setAttribute("aria-pressed", String(active));
  }
}

if (
  stage &&
  moon &&
  replayButton &&
  phaseShadow &&
  typeof phaseShadow.animate === "function"
) {
  const phase = phaseShadow.animate(
    [
      {
        transform: "translate(-45px, -31px) scale(.82)",
        offset: 0,
        easing: coverEasing,
      },
      {
        transform: "translate(0px, 0px) scale(1)",
        offset: 0.8,
        easing: "linear",
      },
      { transform: "translate(0px, 0px) scale(1)", offset: 1 },
    ],
    { duration: 8000, fill: "forwards" },
  );
  phase.pause();
  phase.currentTime = 0;
  moonAnimations.push(phase);
  const phaseLayer = document.querySelector<SVGElement>(".eclipse-phase");
  if (phaseLayer) {
    // 6.4 秒で月面ごと消し、遮蔽円の縁に残るアンチエイリアスの残滓を除く。
    const surface = phaseLayer.animate(
      [
        { opacity: 1, offset: 0 },
        { opacity: 1, offset: 0.8 },
        { opacity: 0, offset: 0.8 },
        { opacity: 0, offset: 1 },
      ],
      { duration: 8000, fill: "forwards" },
    );
    surface.pause();
    surface.currentTime = 0;
    moonAnimations.push(surface);
  }
  const moon = document.querySelector<HTMLElement>(".eclipse");
  if (moon) {
    const camera = moon.animate(
      [
        {
          filter: "blur(0px)",
          transform: "translate(0px, 0px) scale(1)",
          offset: 0,
          easing: "ease-in-out",
        },
        {
          filter: "blur(2.4px)",
          transform: "translate(-1.5px, 1px) scale(1.015)",
          offset: 0.12,
          easing: "ease-in-out",
        },
        {
          filter: "blur(.6px)",
          transform: "translate(-4px, 2px) scale(1.03)",
          offset: 0.35,
          easing: "ease-in-out",
        },
        {
          filter: "blur(.2px)",
          transform: "translate(2px, -1px) scale(1.015)",
          offset: 0.56,
          easing: "ease-in-out",
        },
        {
          filter: "blur(0px)",
          transform: "translate(0px, 0px) scale(1)",
          offset: 0.8,
        },
        {
          filter: "blur(0px)",
          transform: "translate(0px, 0px) scale(1)",
          offset: 1,
        },
      ],
      { duration: 8000, fill: "forwards" },
    );
    camera.pause();
    camera.currentTime = 0;
    moonAnimations.push(camera);
  }
  const film = document.querySelector<SVGElement>(".eclipse-film");
  if (film) {
    const grain = film.animate(
      [
        { opacity: 0.035, transform: "translate(0, 0)", offset: 0 },
        { opacity: 0.12, transform: "translate(0, 0)", offset: 0.15 },
        { opacity: 0.055, transform: "translate(0, 0)", offset: 0.35 },
        { opacity: 0.1, transform: "translate(0, 0)", offset: 0.55 },
        { opacity: 0.035, transform: "translate(0, 0)", offset: 0.8 },
        { opacity: 0, transform: "translate(0, 0)", offset: 0.8 },
        { opacity: 0, transform: "translate(0, 0)", offset: 1 },
      ],
      { duration: 8000, fill: "forwards" },
    );
    grain.pause();
    grain.currentTime = 0;
    moonAnimations.push(grain);
  }
  const halo = document.querySelector<HTMLElement>(".eclipse-halo");
  if (halo) {
    const light = halo.animate(
      [
        { opacity: 0, offset: 0 },
        { opacity: 0, offset: 0.8, easing: "ease-out" },
        { opacity: 1, offset: 1 },
      ],
      { duration: 8000, fill: "forwards" },
    );
    light.pause();
    light.currentTime = 0;
    moonAnimations.push(light);
  }
  const contact = document.querySelector<HTMLElement>(".eclipse-contact");
  if (contact) {
    const impact = contact.animate(
      [
        // 6.28s 立ち上がり → 6.42s 最大 → 6.72s まで保持 → 7.84s 消灯
        { opacity: 0, offset: 0 },
        { opacity: 0, offset: 0.785, easing: "cubic-bezier(.16,1,.3,1)" },
        { opacity: 1, offset: 0.8025 },
        { opacity: 1, offset: 0.84, easing: "ease-out" },
        { opacity: 0, offset: 0.98 },
        { opacity: 0, offset: 1 },
      ],
      { duration: 8000, fill: "forwards" },
    );
    impact.pause();
    impact.currentTime = 0;
    moonAnimations.push(impact);
  }
  const flash = document.querySelector<HTMLElement>(".hero-flash");
  if (flash) {
    const exposure = flash.animate(
      [
        { opacity: 0, offset: 0 },
        { opacity: 0, offset: 0.8, easing: "ease-out" },
        { opacity: 0.85, offset: 0.82, easing: "ease-in-out" },
        { opacity: 0.3, offset: 0.87, easing: "ease-out" },
        { opacity: 0, offset: 0.97 },
        { opacity: 0, offset: 1 },
      ],
      { duration: 8000, fill: "forwards" },
    );
    exposure.pause();
    exposure.currentTime = 0;
    moonAnimations.push(exposure);
  }
  screenImpact = (stage.parentElement ?? stage).animate(
    [
      { transform: "none", offset: 0 },
      { transform: "none", offset: 0.8 },
      { transform: "translate(-6px, 3px)", offset: 0.81 },
      { transform: "translate(4px, -2px)", offset: 0.825 },
      { transform: "translate(-2px, 1px)", offset: 0.84 },
      { transform: "translate(1px, 0px)", offset: 0.855 },
      { transform: "none", offset: 0.87 },
      { transform: "none", offset: 1 },
    ],
    { duration: 8000, fill: "forwards" },
  );
  screenImpact.pause();
  screenImpact.currentTime = 0;
  moonAnimations.push(screenImpact);

  replayButton.hidden = false;
  replayButton.addEventListener("click", (): void => {
    if (completed) {
      elapsed = 0;
      completed = false;
      paused = false;
      manual = true;
      draw();
    } else if (ready && !paused && (!reducedMotion.matches || manual))
      paused = true;
    else {
      paused = false;
      manual = true;
    }
    ready = true;
    update();
  });
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries): void => {
        visible = entries.some((entry): boolean => entry.isIntersecting);
        update();
      },
      { threshold: 0.15 },
    );
    observer.observe(stage);
  } else visible = true;
  document.addEventListener("visibilitychange", update);
  reducedMotion.addEventListener("change", (): void => {
    manual = false;
    if (reducedMotion.matches) fallback();
    draw();
    update();
  });
  window.addEventListener(
    "resize",
    (): void => {
      renderer?.resize();
      measure();
      draw();
    },
    { passive: true },
  );
  window.addEventListener("pagehide", (): void => {
    if (request) cancelAnimationFrame(request);
    request = 0;
    previous = undefined;
    if (exposureLayer) exposureLayer.hidden = true;
    fallback();
    attempted = false;
  });
  window.addEventListener("pageshow", (event): void => {
    if (event.persisted) {
      measure();
      draw();
      update();
    }
  });
  const start = (): void => {
    window.setTimeout((): void => {
      ready = true;
      update();
    }, 1200);
  };
  if (document.readyState === "complete") start();
  else window.addEventListener("load", start, { once: true });
  measure();
  draw();
  update();
}
