import { JOB_STATUS_TO_STEP, type JobStatus, type ProgressStep } from "@videoai/contracts";

/**
 * Progress as a person would describe it (spec section 46).
 *
 * The user sees production steps, never internal stage names. "generating_shots"
 * is our word; "Generating scenes" is theirs, and the difference is the whole
 * point of hiding the machinery behind Auto Mode.
 */

export const STEP_LABELS: Record<ProgressStep, string> = {
  understanding_your_idea: "Understanding your idea",
  writing_storyboard: "Writing storyboard",
  creating_characters: "Creating characters",
  creating_keyframes: "Creating keyframes",
  generating_scenes: "Generating scenes",
  synchronizing_dialogue: "Synchronizing dialogue",
  creating_sound: "Creating sound",
  quality_checking: "Quality checking",
  rendering_final_video: "Rendering final video",
};

export const STEP_ORDER: ProgressStep[] = [
  "understanding_your_idea",
  "writing_storyboard",
  "creating_characters",
  "creating_keyframes",
  "generating_scenes",
  "synchronizing_dialogue",
  "creating_sound",
  "quality_checking",
  "rendering_final_video",
];

export interface StepView {
  step: ProgressStep;
  label: string;
  state: "done" | "active" | "pending";
  detail: string;
}

export function stepsFor(
  status: JobStatus,
  completedUnits = 0,
  totalUnits = 0,
): StepView[] {
  const current = JOB_STATUS_TO_STEP[status];
  const finished = status === "completed";
  const currentIndex = current ? STEP_ORDER.indexOf(current) : finished ? STEP_ORDER.length : -1;

  return STEP_ORDER.map((step, index) => {
    const state: StepView["state"] =
      finished || index < currentIndex ? "done" : index === currentIndex ? "active" : "pending";

    // Only the active step gets a count, and only when there is one to give.
    const detail =
      state === "active" && step === "generating_scenes" && totalUnits > 0
        ? `${completedUnits} / ${totalUnits}`
        : "";

    return { step, label: STEP_LABELS[step], state, detail };
  });
}

/**
 * What to tell the user when a job stops without finishing.
 *
 * Never a raw inference error (spec section 105): the message names what could
 * not be achieved and offers the choices that exist.
 */
export interface FailureView {
  headline: string;
  explanation: string;
  actions: Array<{ id: "repair" | "edit" | "accept" | "retry"; label: string }>;
}

export function failureFor(status: JobStatus, shotsNeedingReview: string[] = []): FailureView | null {
  if (status === "needs_review") {
    const which =
      shotsNeedingReview.length === 1
        ? `Scene ${shotsNeedingReview[0]}`
        : `${shotsNeedingReview.length} scenes`;
    return {
      headline: `${which} could not reach the required quality.`,
      explanation:
        "Everything else finished. You can try repairing the scenes that fell short, adjust them yourself, " +
        "or use the best attempt as it is.",
      actions: [
        { id: "repair", label: "Try repair" },
        { id: "edit", label: "Edit scene" },
        { id: "accept", label: "Use best attempt" },
      ],
    };
  }

  if (status === "failed") {
    return {
      headline: "This video could not be completed.",
      explanation: "Something went wrong on our side rather than with your idea. Trying again often works.",
      actions: [{ id: "retry", label: "Try again" }],
    };
  }

  if (status === "cancelled") {
    return {
      headline: "You stopped this video.",
      explanation: "Everything generated before you stopped has been kept.",
      actions: [{ id: "retry", label: "Start again" }],
    };
  }

  return null;
}
