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
    const sequences = new Map<Element | null, number>();
    for (const entry of entries) {
      if (!entry.isIntersecting || !(entry.target instanceof HTMLElement)) continue;
      const element = entry.target;
      observer.unobserve(element);
      if (motionPreference.matches || element.contains(document.activeElement)) continue;
      const sequence = sequences.get(element.parentElement) ?? 0;
      sequences.set(element.parentElement, sequence + 1);
      const animation = element.animate(
        [{ opacity: 0.08, transform: "translateY(22px)" }, { opacity: 1, transform: "translateY(0)" }],
        { duration: 1000, delay: Math.min(sequence * 100, 300), easing: "cubic-bezier(.25,.1,.25,1)", fill: "backwards" },
      );
      activeReveals.set(element, animation);
      animation.onfinish = (): void => { activeReveals.delete(element); };
    }
  }, { threshold: 0, rootMargin: "0px 0px -48px 0px" });

  document.querySelectorAll<HTMLElement>(selectors.join(",")).forEach((element): void => {
    if (element.parentElement?.closest(selectors.join(","))) return;
    if (element.matches(".section-heading")) {
      Array.from(element.children).forEach((child): void => {
        if (child instanceof HTMLElement) observer.observe(child);
      });
    } else observer.observe(element);
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
