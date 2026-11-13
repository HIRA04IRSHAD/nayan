"use client";
// The way into "खुराक जाँच (ब्लिस्टर)" from the Check and Today screens: one big button with a one-line why.

import { SAY } from "@/lib/messages";
import { useApp } from "@/components/app/AppContext";
import { Button } from "@/components/ui/Button";

export function DoseCheckEntry({ itemId }: { itemId?: string }) {
  const { busy, say, dose, state } = useApp();
  if (!state.prescription) return null;
  return (
    <div className="stack stack--tight">
      <Button
        icon="blister"
        aria-disabled={!!busy}
        whenUnavailable={() => void say(SAY.wait)}
        aria-describedby="dose-entry-hint"
        onClick={() => dose.start(itemId)}
      >
        खुराक जाँच (ब्लिस्टर)
      </Button>
      <p id="dose-entry-hint" className="hint">
        गोली लेने से पहले पत्ते के पीछे की फ़ोटो लीजिए: नयन खाली खाने गिनकर बताएगा कि खुराक पहले ही तो नहीं ली गई।
      </p>
    </div>
  );
}
