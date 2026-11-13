// The app lives at /app (the website is at /). Thin entry point: the app itself is components/NayanApp.tsx
// (screens in components/screens/). /app?demo=1 opens the demo prescription when nothing is saved yet.
import NayanApp from "@/components/NayanApp";

export default function AppPage() {
  return <NayanApp />;
}
