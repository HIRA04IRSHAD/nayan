// Small pieces shared by several screens.
import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import { SITE_PATH } from "@/lib/app-url";

export function Notice({ tone = "info", icon, title, children }: { tone?: "info" | "warn"; icon?: IconName; title?: ReactNode; children: ReactNode }) {
  return (
    <div className={`notice notice--${tone}`}>
      <Icon name={icon ?? (tone === "warn" ? "alert" : "info")} size={26} className="notice-icon" />
      <div>
        {title && <p className="notice-title">{title}</p>}
        <div className="notice-body">{children}</div>
      </div>
    </div>
  );
}

export function NoKeyNotice() {
  return (
    <Notice tone="warn" title="फ़ोटो पढ़ने की सेवा बंद है">
      <p>
        सर्वर पर Gemini API key नहीं लगी है, इसलिए कैमरे की फ़ोटो नहीं पढ़ी जा सकती। तब तक डेमो से आज़माइए।
      </p>
      <p className="en" lang="en">
        Set GEMINI_API_KEY in .env.local (or on Vercel) to enable photo reading.
      </p>
    </Notice>
  );
}

/** A small link to the website (/), which explains Nayan to families, doctors and visitors. */
export function AboutLink() {
  return (
    <p className="about-link">
      {/* A plain link (not next/link): the website has its own root layout, so this is a full page load. */}
      <a href={SITE_PATH}>
        <Icon name="info" size={22} />
        <span>
          नयन के बारे में{" "}
          <span className="en" lang="en">
            (About Nayan)
          </span>
        </span>
      </a>
    </p>
  );
}

export function Disclaimer() {
  return <p className="disclaimer">नयन एक जाँच सहायक है, डॉक्टरी सलाह नहीं। शक हो तो डॉक्टर या केमिस्ट से ज़रूर पूछिए।</p>;
}
