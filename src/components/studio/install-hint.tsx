import { useEffect, useState } from "react";

const DISMISS_KEY = "aether-a2hs-dismissed";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function InstallHint() {
  const [dismissed, setDismissed] = useState(false);
  const [standalone, setStandalone] = useState(false);
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const nav = navigator as Navigator & { standalone?: boolean };
    const installed = window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
    setStandalone(installed);
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      /* private mode — the hint can stay */
    }
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    if (import.meta.env.PROD && window.top === window.self && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* install still works from the browser menu if registration is blocked */
      });
    }
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (dismissed || standalone) return null;

  function dismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* the hint stays gone for this visit */
    }
  }

  async function install() {
    if (!promptEvent) return;
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    setPromptEvent(null);
    if (choice.outcome === "accepted") dismiss();
  }

  return (
    <aside className="mb-2 flex h-8 max-h-8 items-center gap-2 overflow-hidden rounded-full bg-ink-2 px-3 hairline" aria-label="Add to Home screen">
      <p className="min-w-0 flex-1 truncate text-[11px] leading-none text-muted">Add to Home screen</p>
      {promptEvent ? (
        <button type="button" onClick={() => void install()} className="h-6 shrink-0 rounded-full bg-seal px-2 text-[11px] font-semibold text-paper">
          Install
        </button>
      ) : null}
      <button type="button" onClick={dismiss} className="h-6 shrink-0 rounded-full px-2 text-[11px] text-paper" aria-label="Dismiss add to home screen">
        Close
      </button>
    </aside>
  );
}
