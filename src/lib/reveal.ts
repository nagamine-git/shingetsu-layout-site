const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
const activeReveals = new Map<HTMLElement, Animation>();

function finishReveals(): void {
  activeReveals.forEach((animation): void => animation.cancel());
  activeReveals.clear();
}

if ("IntersectionObserver" in window && "animate" in Element.prototype) {
  const selectors = [
    "[data-reveal]", ".hero-instrument", ".typing-instrument", ".github-support",
    ".os-panel > div", ".faq-section details", ".subscribe-section > div > *",
    ".post-card", ".prose > h2", ".prose > h3",
  ];
  const observer = new IntersectionObserver((entries): void => {
    let sequence = 0;
    for (const entry of entries) {
      if (!entry.isIntersecting || !(entry.target instanceof HTMLElement)) continue;
      const element = entry.target;
      observer.unobserve(element);
      if (motionPreference.matches || element.contains(document.activeElement)) continue;
      const animation = element.animate(
        [{ opacity: 0.35, transform: "translateY(18px)" }, { opacity: 1, transform: "translateY(0)" }],
        { duration: 720, delay: Math.min(sequence++ * 85, 255), easing: "cubic-bezier(.22,1,.36,1)", fill: "backwards" },
      );
      activeReveals.set(element, animation);
      animation.onfinish = (): void => { activeReveals.delete(element); };
    }
  }, { threshold: 0, rootMargin: "0px 0px -24px 0px" });

  document.querySelectorAll<HTMLElement>(selectors.join(",")).forEach((element): void => {
    if (!element.parentElement?.closest(selectors.join(","))) observer.observe(element);
  });

  document.addEventListener("focusin", (event): void => {
    if (!(event.target instanceof Node)) return;
    const target = event.target;
    activeReveals.forEach((animation, element): void => {
      if (element.contains(target)) {
        animation.cancel();
        activeReveals.delete(element);
      }
    });
  });
  document.addEventListener("visibilitychange", (): void => {
    if (document.hidden) finishReveals();
  });
  window.addEventListener("beforeprint", finishReveals);
  motionPreference.addEventListener("change", (): void => {
    if (motionPreference.matches) finishReveals();
  });
}
