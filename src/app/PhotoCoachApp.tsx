"use client";

import { useEffect, useState } from "react";
import type { PreparationGuide } from "@/components/recycling/PreparationSummary";
import { PhotoRecyclingCoach } from "@/components/recycling/PhotoRecyclingCoach";
import { createBrowserCoachAudio, createCoachAssistanceTransport } from "@/lib/client/coach-audio";
import { createCoachController, type CoachController } from "@/lib/client/coach-controller";
import { sendCoachRecognition } from "@/lib/client/coach-recognition";
import type { GuideCatalog } from "@/lib/contracts/coach";

type Runtime = { controller: CoachController; unlockPlayback: () => void };

/** Own browser resources per mounted effect, including React's setup/cleanup replay. */
export function PhotoCoachApp({ catalog, preparationGuides }: { catalog: GuideCatalog; preparationGuides?: PreparationGuide[] }) {
  const [runtime, setRuntime] = useState<Runtime | null>(null);

  useEffect(() => {
    const audio = createBrowserCoachAudio();
    const controller = createCoachController({
      catalog,
      recognize: sendCoachRecognition,
      assistance: createCoachAssistanceTransport(),
      audio,
    });
    // BFCache can keep React mounted; clear user state while retaining a reusable runtime.
    const resetOnPageHide = () => controller.reset();
    window.addEventListener("pagehide", resetOnPageHide);
    // The resource is browser-only and must be recreated after StrictMode cleanup.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRuntime({
      controller,
      unlockPlayback: () => { void audio.unlockPlayback().catch(() => {}); },
    });
    return () => {
      window.removeEventListener("pagehide", resetOnPageHide);
      controller.dispose();
    };
  }, [catalog]);

  if (!runtime) return <main aria-busy="true"><p role="status">사진 안내를 준비하고 있어요.</p></main>;
  return <PhotoRecyclingCoach controller={runtime.controller} catalog={catalog} preparationGuides={preparationGuides} onAudioGesture={runtime.unlockPlayback} />;
}
