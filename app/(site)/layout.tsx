import type { Metadata, Viewport } from "next";
import { Fira_Code, Instrument_Serif, Inter_Tight, Noto_Sans_Devanagari } from "next/font/google";
import "./site.css";

// Root layout of the website at "/". It is a separate root layout (route group "(site)"), so the app's design
// system (app/(app)/globals.css) never loads here, and this file's site.css never loads in the app.

const sans = Inter_Tight({ subsets: ["latin"], weight: ["300", "400", "500", "600"], display: "swap", variable: "--f-sans" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: "italic", display: "swap", variable: "--f-serif" });
const mono = Fira_Code({ subsets: ["latin"], weight: "400", display: "swap", variable: "--f-mono" });
const deva = Noto_Sans_Devanagari({ subsets: ["devanagari"], weight: ["300", "400", "500", "600"], display: "swap", variable: "--f-deva" });

export const metadata: Metadata = {
  title: "Nayan — Verify once, know by touch",
  description:
    "A Hindi, voice-first medicine check for blind and low-vision people: it reads the prescription, checks every strip with fixed safety rules, and marks verified strips with a tactile tag.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0d0830" };

// Runs before first paint: the design unit --u (section 4 of the spec) and a failsafe that ends the entrance guard.
const BOOT = `(function(){var d=document.documentElement;function u(){var w=d.clientWidth||window.innerWidth;d.style.setProperty('--u',(w/(w>820?1440:390))+'px')}u();window.addEventListener('resize',u);
if(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches){d.classList.remove('anim')}
setTimeout(function(){d.classList.remove('anim')},3000)})();`;

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`anim ${sans.variable} ${serif.variable} ${mono.variable} ${deva.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: BOOT }} />
        <noscript>
          <style>{`html.anim [data-in]{opacity:1!important}.reveal{opacity:1!important;transform:none!important}`}</style>
        </noscript>
      </head>
      <body className="site">{children}</body>
    </html>
  );
}
