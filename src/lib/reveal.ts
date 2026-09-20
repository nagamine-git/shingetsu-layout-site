const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
const activeReveals = new Map<HTMLElement, Animation>();
const pendingReveals = new Set<HTMLElement>();
const landingPage = document.querySelector("#main-content > .hero") !== null;
let scrollStarted = window.scrollY > 0 || Boolean(window.location.hash);

function finishReveals(): void {
  activeReveals.forEach((animation): void => animation.cancel());
  activeReveals.clear();
  pendingReveals.forEach((element): void => element.removeAttribute("data-reveal-pending"));
  pendingReveals.clear();
}

if ("IntersectionObserver" in window && "animate" in Element.prototype) {
  const selectors = [
    "[data-reveal]", ".hero-instrument", ".typing-instrument", ".github-support",
    ".os-panel > div", ".faq-section details", ".subscribe-section > div > *",
    ".post-card", ".prose > h2", ".prose > h3",
    ".content-section > div > *", "#main-content > .hero ~ div",
  ];
  const observer = new IntersectionObserver((entries): void => {
    const sequences = new Map<Element | null, number>();
    for (const entry of entries) {
      if (!entry.isIntersecting || !(entry.target instanceof HTMLElement)) continue;
      const element = entry.target;
      if (pendingReveals.has(element) && !scrollStarted) continue;
      observer.unobserve(element);
      element.removeAttribute("data-reveal-pending");
      pendingReveals.delete(element);
      if (motionPreference.matches || element.contains(document.activeElement)) continue;
      const sequence = sequences.get(element.parentElement) ?? 0;
      sequences.set(element.parentElement, sequence + 1);
      try {
        const animation = element.animate(
          [{ opacity: 0, transform: "translateY(22px)" }, { opacity: 1, transform: "translateY(0)" }],
          { duration: 1000, delay: Math.min(sequence * 100, 300), easing: "cubic-bezier(.25,.1,.25,1)", fill: "backwards" },
        );
        activeReveals.set(element, animation);
        animation.onfinish = (): void => { activeReveals.delete(element); };
      } catch {
        finishReveals();
        observer.disconnect();
        break;
      }
    }
  }, { threshold: 0, rootMargin: "0px 0px -48px 0px" });

  function observeElement(element: HTMLElement): void {
    if (element.matches("script, style, noscript")) return;
    observer.observe(element);
    if (landingPage && !element.closest(".hero") && !motionPreference.matches) {
      pendingReveals.add(element);
      element.setAttribute("data-reveal-pending", "");
    }
  }

  document.querySelectorAll<HTMLElement>(selectors.join(",")).forEach((element): void => {
    if (element.parentElement?.closest(selectors.join(","))) return;
    if (element.matches(".section-heading, .feature-grid")) {
      Array.from(element.children).forEach((child): void => {
        if (child instanceof HTMLElement) observeElement(child);
      });
    } else observeElement(element);
  });

  window.addEventListener("scroll", (): void => {
    if (scrollStarted || window.scrollY === 0) return;
    scrollStarted = true;
    pendingReveals.forEach((element): void => {
      observer.unobserve(element);
      observer.observe(element);
    });
  }, { passive: true });

  document.addEventListener("focusin", (event): void => {
    if (!(event.target instanceof Node)) return;
    const target = event.target;
    pendingReveals.forEach((element): void => {
      if (element.contains(target)) {
        observer.unobserve(element);
        element.removeAttribute("data-reveal-pending");
        pendingReveals.delete(element);
      }
    });
    activeReveals.forEach((animation, element): void => {
      if (element.contains(target)) {
        animation.cancel();
        activeReveals.delete(element);
      }
    });
  });
  document.addEventListener("visibilitychange", (): void => {
    if (document.hidden) {
      activeReveals.forEach((animation): void => animation.cancel());
      activeReveals.clear();
    }
  });
  window.addEventListener("beforeprint", finishReveals);
  motionPreference.addEventListener("change", (): void => {
    if (motionPreference.matches) finishReveals();
  });
}
