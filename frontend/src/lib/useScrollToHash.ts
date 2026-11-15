import { useEffect } from "react";

/**
 * Scroll to the element named by a URL hash. Sections above it are still loading and growing when the page
 * opens, so it scrolls again a few times, and stops as soon as the person scrolls themselves.
 */
export function useScrollToHash(hash: string, key: string): void {
  useEffect(() => {
    const id = hash.replace(/^#/, "");
    if (!id) return;
    let userScrolled = false;
    const onUser = () => { userScrolled = true; };
    const go = () => { if (!userScrolled) document.getElementById(id)?.scrollIntoView({ block: "start" }); };
    window.addEventListener("wheel", onUser, { passive: true });
    window.addEventListener("touchmove", onUser, { passive: true });
    window.addEventListener("keydown", onUser);
    go();
    const timers = [600, 1500, 3000].map((ms) => setTimeout(go, ms));
    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener("wheel", onUser);
      window.removeEventListener("touchmove", onUser);
      window.removeEventListener("keydown", onUser);
    };
  }, [hash, key]);
}
