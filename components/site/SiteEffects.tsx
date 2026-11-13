"use client";

// Every moving part of the website at "/": scroll crossfade of the fixed scene, nav state, the hero entrance,
// scroll reveals, the typed code block, the WebGL ripple lens over the pond video and the Three.js koi
// (loaded on demand). Everything is torn down on unmount; any failing piece (WebGL, video, GLB) degrades to the
// still images and plain HTML.
import { useEffect } from "react";
import { pointer, smoothstep } from "./pointer";

export default function SiteEffects() {
  useEffect(() => {
    const cleanups: (() => void)[] = [];
    const on = <K extends keyof WindowEventMap>(t: Window, type: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      t.addEventListener(type, fn as EventListener, opts);
      cleanups.push(() => t.removeEventListener(type, fn as EventListener));
    };
    const root = document.documentElement;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const $ = (id: string) => document.getElementById(id);

    // ---- design unit (also set by the boot script; kept here for client navigations) ----
    const setU = () => {
      const w = root.clientWidth || window.innerWidth;
      root.style.setProperty("--u", `${w / (w > 820 ? 1440 : 390)}px`);
    };
    setU();
    on(window, "resize", setU);

    // ---- shared pointer ----
    const onMove = (e: PointerEvent) => {
      pointer.u = e.clientX / window.innerWidth;
      pointer.v = 1 - e.clientY / window.innerHeight;
      pointer.tx = pointer.u * 2 - 1;
      pointer.ty = pointer.v * 2 - 1;
      pointer.inside = true;
    };
    const onLeave = () => {
      pointer.inside = false;
      pointer.tx = pointer.ty = 0;
    };
    on(window, "pointermove", onMove, { passive: true });
    root.addEventListener("pointerleave", onLeave);
    cleanups.push(() => root.removeEventListener("pointerleave", onLeave));

    // ---- video ----
    const video = $("pond") as HTMLVideoElement | null;
    if (video && !reduced && video.dataset.src) {
      video.src = video.dataset.src;
      video.play().catch(() => {});
    }
    cleanups.push(() => {
      if (video) {
        video.pause();
        video.removeAttribute("src");
        video.load();
      }
    });

    // ---- scroll crossfade + nav ----
    const day = $("sc-day");
    const violet = $("sc-violet");
    const night = $("sc-night");
    const nav = $("nav");
    const end = $("end");
    const onScroll = () => {
      const h = window.innerHeight;
      const y = window.scrollY;
      const toViolet = smoothstep(0.15 * h, 1.05 * h, y);
      const endTop = end ? end.offsetTop : document.body.scrollHeight;
      const toNight = smoothstep(endTop - 1.1 * h, endTop - 0.1 * h, y);
      if (day) {
        day.style.opacity = String(1 - toViolet);
        day.style.transform = `scale(${1 + 0.08 * toViolet}) translateY(${-0.06 * y}px)`;
      }
      if (violet) violet.style.opacity = String(toViolet * (1 - toNight));
      if (night) night.style.opacity = String(toNight);
      nav?.classList.toggle("scrolled", y > 0.5 * h);
      if (video && video.src) {
        if (toViolet < 0.999) {
          if (video.paused) video.play().catch(() => {});
        } else if (!video.paused) video.pause();
      }
    };
    onScroll();
    on(window, "scroll", onScroll, { passive: true });
    on(window, "resize", onScroll);

    // ---- scroll card ----
    const scard = $("scard");
    const toStudio = () => $("studio")?.scrollIntoView({ behavior: reduced ? "auto" : "smooth" });
    scard?.addEventListener("click", toStudio);
    cleanups.push(() => scard?.removeEventListener("click", toStudio));

    // ---- hero entrance ----
    const anims: Animation[] = [];
    if (!reduced && root.classList.contains("anim")) {
      const ease = "cubic-bezier(.2,.75,.2,1)";
      const steps: [string, Keyframe, number, number][] = [
        ["nav", { opacity: 0, transform: "translateY(-14px)" }, 0, 900],
        ["hl1", { opacity: 0, transform: "translateY(105%)" }, 250, 1100],
        ["hl2", { opacity: 0, transform: "translateY(105%)" }, 370, 1100],
        ["hsub", { opacity: 0, transform: "translateY(12px)" }, 620, 900],
        ["hbtns", { opacity: 0, transform: "translateY(14px)" }, 740, 900],
        ["scard", { opacity: 0, transform: "translateY(40px) scale(.96)" }, 880, 1100],
      ];
      for (const [id, from, delay, duration] of steps) {
        const el = $(id);
        if (el?.animate) anims.push(el.animate([from, { opacity: 1, transform: "none" }], { delay, duration, easing: ease, fill: "backwards" }));
      }
    }
    const raf0 = requestAnimationFrame(() => root.classList.remove("anim"));
    // Failsafe: the timeline ends by 2 s; if the page's clock was frozen (background tab), show the hero anyway.
    const failsafe = window.setTimeout(() => {
      root.classList.remove("anim");
      anims.forEach((a) => a.playState !== "finished" && a.finish());
    }, 3000);
    cleanups.push(() => {
      cancelAnimationFrame(raf0);
      clearTimeout(failsafe);
      anims.forEach((a) => a.cancel());
      root.classList.remove("anim");
    });

    // ---- reveals ----
    const reveals = Array.from(document.querySelectorAll<HTMLElement>(".reveal"));
    if (reduced || !("IntersectionObserver" in window)) reveals.forEach((el) => el.classList.add("in"));
    else {
      const io = new IntersectionObserver(
        (entries) => {
          for (const e of entries)
            if (e.isIntersecting) {
              e.target.classList.add("in");
              io.unobserve(e.target);
            }
        },
        { threshold: 0.15 },
      );
      reveals.forEach((el) => io.observe(el));
      cleanups.push(() => io.disconnect());
    }

    // ---- typed code ----
    const code = $("code");
    const typed = $("typed");
    const text = (code?.querySelector("pre") as HTMLElement | null)?.dataset.text ?? "";
    let typeTimer = 0;
    if (typed) {
      if (reduced) typed.textContent = text;
      else if (code) {
        let i = 0;
        const tick = () => {
          if (i >= text.length) {
            typeTimer = window.setTimeout(() => {
              i = 0;
              typed.textContent = "";
              tick();
            }, 3200);
            return;
          }
          const ch = text[i++];
          typed.textContent += ch;
          typeTimer = window.setTimeout(tick, ch === "\n" ? 120 : 22);
        };
        const io = new IntersectionObserver(
          (entries) => {
            if (entries.some((e) => e.isIntersecting)) {
              io.disconnect();
              tick();
            }
          },
          { threshold: 0.3 },
        );
        io.observe(code);
        cleanups.push(() => io.disconnect());
      }
    }
    cleanups.push(() => clearTimeout(typeTimer));

    // ---- ripple lens + koi (client-only modules) ----
    let disposed = false;
    if (!reduced && video) {
      void import("./pondLens").then(({ startPondLens }) => {
        if (disposed) return;
        cleanups.push(startPondLens(video, $("pondfx") as HTMLCanvasElement));
      });
    }
    const koiCanvas = $("koi") as HTMLCanvasElement | null;
    if (koiCanvas) {
      void import("./koi")
        .then(({ startKoi }) => {
          if (disposed) return;
          cleanups.push(startKoi(koiCanvas, reduced));
        })
        .catch(() => {});
    }

    return () => {
      disposed = true;
      cleanups.splice(0).reverse().forEach((fn) => {
        try {
          fn();
        } catch {
          /* ignore */
        }
      });
    };
  }, []);

  return null;
}
