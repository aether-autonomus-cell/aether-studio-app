import { createFileRoute } from "@tanstack/react-router";
import { KathaRiftStudioApp } from "@/components/katharift/KathaRiftStudioApp";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <KathaRiftStudioApp />;
}
