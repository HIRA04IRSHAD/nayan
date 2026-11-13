// The caregiver's page: opened from the link the patient shares ("परिवार से पूछें").
// The token is in the URL #fragment, so the server never sees it with this page request; the client
// component reads it and calls the case API. Nothing personal is rendered on the server.
import type { Metadata } from "next";
import { CaregiverCasePage } from "@/components/caregiver/CaregiverCasePage";

export const metadata: Metadata = {
  title: "नयन – परिवार से सवाल",
  description: "क्या यह सही दवा है? फ़ोटो देखकर बताइए।",
  // Private, short-lived links: never indexed, and never leak their address to other sites as a Referer.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function CaregiverCase({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CaregiverCasePage id={id} />;
}
