"use client";
// Shown on every screen while the phone is offline: what still works (everything saved on the phone) and what
// needs internet (reading photos, family links), so a failed camera check is not a surprise.

import { useOnline } from "@/components/app/useClock";
import { Icon } from "@/components/ui/Icon";

export function OfflineNotice() {
  const online = useOnline();
  if (online) return null;
  return (
    <p className="offline-note" role="status">
      <Icon name="offline" size={24} />
      <span>
        इंटरनेट नहीं है। सेव की हुई दवाएँ, टैग और आज की सूची चलती रहेंगी; फ़ोटो से जाँच और परिवार को लिंक भेजने के लिए
        इंटरनेट चाहिए।
      </span>
    </p>
  );
}
