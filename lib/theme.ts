// Theme constants shared by the server layout (boot script, <meta theme-color>) and the client app.
// No React imports here: app/layout.tsx is a server component.
import type { Theme } from "./types";

/** localStorage key of the saved app state (lib/store.ts). Here so the layout can read the theme before React loads. */
export const STORAGE_KEY = "nayan.state.v2";

/** Must match --bg in app/globals.css for each theme (browser bar / PWA title bar colour). */
export const THEME_COLOR: Record<Theme, string> = { dark: "#0d0830", light: "#f1efff" };

/**
 * Runs in <head> before the first paint: applies the saved theme so a light-theme user never sees a dark flash.
 * Plain ES5, wrapped in try/catch because storage access can throw (private mode, blocked site data).
 */
export const THEME_BOOT_SCRIPT = `try{var s=JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEY)})||"null");var t=s&&s.settings&&s.settings.theme;if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t);var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",t==="light"?${JSON.stringify(THEME_COLOR.light)}:${JSON.stringify(THEME_COLOR.dark)});}}catch(e){}`;
