"use client";
// Four large tabs at the bottom, within thumb reach on a one-handed phone. The open tab is marked with
// aria-current and, visually, with a filled pill and bold label (never colour alone).

import { useApp } from "@/components/app/AppContext";
import { TABS } from "@/components/app/tabs";
import { Icon } from "@/components/ui/Icon";

export function BottomNav() {
  const { tab, goTo } = useApp();
  return (
    <nav className="tabbar" aria-label="मुख्य मेनू">
      <ul className="tabbar-list">
        {TABS.map((t) => (
          <li key={t.id}>
            <button type="button" className="tabbar-btn" aria-current={tab === t.id ? "page" : undefined} onClick={() => goTo(t.id)}>
              <span className="tabbar-icon">
                <Icon name={t.icon} size={26} />
              </span>
              <span className="tabbar-label">{t.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
