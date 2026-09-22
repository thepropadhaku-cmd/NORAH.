import { cn } from "@/lib/utils";

export type OrbState = "idle" | "summon" | "listening" | "thinking" | "speaking" | "dismiss";

/**
 * NORAH's summoned presence — a small black glass orb with thin
 * luminous filaments, plus a translucent "living film" that gently
 * rises from the bottom of the viewport while she's actively engaged.
 *
 * Pure CSS state machine (see .norah-orb / .norah-film rules in
 * index.css); this component only chooses the state and size, so it
 * stays cheap to render inline wherever presence needs to be shown.
 *
 * The film only appears for the larger, "primary" orb instance (the
 * one whose state actually reflects the live conversation) — small
 * decorative orb instances (chat message avatars, list icons) stay
 * exactly as before and never spawn it, so multiple orb instances on
 * screen at once never produce duplicate overlays.
 */
const FILM_ELIGIBLE_MIN_SIZE = 24;

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
  const showFilm = size >= FILM_ELIGIBLE_MIN_SIZE && state !== "idle";

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
        <div className="norah-orb__filament norah-orb__filament--a" />
        <div className="norah-orb__filament norah-orb__filament--b" />
        <div className="norah-orb__sheen" />
      </div>

      {showFilm && (
        <div className="norah-film" aria-hidden="true">
          <div className="norah-film__body" />
          <div className="norah-film__crest norah-film__crest--a" />
          <div className="norah-film__crest norah-film__crest--b" />
          <div className="norah-film__crest norah-film__crest--c" />
        </div>
      )}
    </div>
  );
}
