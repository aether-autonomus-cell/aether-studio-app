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
    <aside className="mb-4 rounded-2xl bg-ink-2 p-4 hairline" aria-label="Add to Home screen">
      <p className="text-sm font-semibold text-paper">Add to Home screen</p>
      <p className="mt-1 text-sm text-muted">
        Opens like an app. iPhone: Share, then Add to Home Screen. Android: the browser menu, then Install app or Add to Home screen.
      </p>
      <div className="mt-3 flex gap-2">
        {promptEvent ? (
          <button type="button" onClick={() => void install()} className="min-h-11 flex-1 rounded-xl bg-seal text-sm font-semibold text-paper">
            Install
          </button>
        ) : null}
        <button type="button" onClick={dismiss} className="min-h-11 flex-1 rounded-xl bg-panel text-sm text-paper">
          Not now
        </button>
      </div>
    </aside>
  );
}
