import { cn } from "@/lib/utils";

export type OrbState = "idle" | "summon" | "listening" | "thinking" | "speaking" | "dismiss";

/**
 * NORAH's summoned orb — the single recurring visual identity element.
 * Pure CSS state machine (see .norah-orb rules in index.css); this
 * component only chooses the state and size, so it stays cheap to
 * render inline wherever presence needs to be shown.
 */
export function NorahOrb({
  state,
  size = 44,
  className,
  onAnimationEnd,
}: {
  state: OrbState;
  size?: number;
  className?: string;
  onAnimationEnd?: () => void;
}) {
  return (
    <div
      className={cn("norah-orb", className)}
      data-state={state}
      style={{ width: size, height: size }}
      onAnimationEnd={onAnimationEnd}
      role="img"
      aria-label={
        state === "thinking" ? "Norah is thinking" :
        state === "speaking" ? "Norah is speaking" :
        state === "listening" ? "Norah is listening" :
        "Norah"
      }
    >
      <div className="norah-orb__halo" />
      <div className="norah-orb__glass">
        <div className="norah-orb__core" />
        <div className="norah-orb__sheen" />
      </div>
    </div>
  );
}
