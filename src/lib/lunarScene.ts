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

function easedCover(progress: number): number {
  if (progress >= 1) return 1;
  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 16; iteration += 1) {
    const middle = (low + high) / 2;
    const inverse = 1 - middle;
    const position =
      3 * inverse * inverse * middle * 0.4 +
      3 * inverse * middle * middle * 0.2 +
      middle ** 3;
    if (position < progress) low = middle;
    else high = middle;
  }
  const parameter = (low + high) / 2;
  return 3 * (1 - parameter) * parameter ** 2 + parameter ** 3;
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
        easing: "cubic-bezier(.4,0,.2,1)",
      },
      {
        transform: "translate(0px, 0px) scale(1.005)",
        offset: 0.8,
        easing: "linear",
      },
      { transform: "translate(0px, 0px) scale(1.005)", offset: 1 },
    ],
    { duration: 8000, fill: "forwards" },
  );
  phase.pause();
  phase.currentTime = 0;
  moonAnimations.push(phase);
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
        { opacity: 0.035, transform: "translate(0, 0)", offset: 1 },
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
        { opacity: 0, offset: 0 },
        { opacity: 0, offset: 0.8, easing: "cubic-bezier(.16,1,.3,1)" },
        { opacity: 1, offset: 0.82, easing: "ease-in-out" },
        { opacity: 0.55, offset: 0.875, easing: "ease-out" },
        { opacity: 0, offset: 0.97 },
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
  draw();
  update();
}
