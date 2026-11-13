import type { Metadata, Viewport } from "next";
import { Fira_Code, Instrument_Serif, Inter_Tight, Noto_Sans_Devanagari } from "next/font/google";
import { THEME_BOOT_SCRIPT, THEME_COLOR } from "@/lib/theme";
import "./globals.css";

// Root layout of the app route group: /app (the app) and /c/[id] (family links). The website at / has its own
// root layout in app/(site)/, so this design system (globals.css) and the site's styles never meet.
//
// Self-hosted at build time by next/font (no request to Google from the phone). Devanagari + Latin so
// Hindi text and brand names ("Dolo 650") share one typeface; system fonts stay as the fallback.
const devanagari = Noto_Sans_Devanagari({
  subsets: ["devanagari", "latin"],
  weight: ["400", "500", "700", "800"],
  display: "swap",
  variable: "--font-devanagari",
});
// The website's Latin type: Inter Tight for text, Instrument Serif italic for small accents, Fira Code for meta.
const interTight = Inter_Tight({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], display: "swap", variable: "--font-inter-tight" });
const instrumentSerif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: "italic", display: "swap", variable: "--font-instrument-serif" });
const firaCode = Fira_Code({ subsets: ["latin"], weight: ["400", "500"], display: "swap", variable: "--font-fira-code" });

export const metadata: Metadata = {
  title: "नयन – दवा जाँच",
  description: "पर्चे से दवा का पत्ता मिलाइए — हिंदी में, आवाज़ से।",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg", apple: "/icon-192.png" },
  appleWebApp: { capable: true, title: "नयन", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // No maximumScale: low-vision users must always be able to pinch-zoom.
  viewportFit: "cover",
  themeColor: THEME_COLOR.dark,
  colorScheme: "dark light",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // data-theme="dark" is the default; the boot script switches it before first paint when light was saved.
    // suppressHydrationWarning: that script may change the attribute before React hydrates.
    <html lang="hi" data-theme="dark" className={`${devanagari.variable} ${interTight.variable} ${instrumentSerif.variable} ${firaCode.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>
        <a className="skip-link" href="#main">
          सीधे मुख्य हिस्से पर जाएँ
        </a>
        {children}
      </body>
    </html>
  );
}
