/**
 * Pointer interactions may use subtle feedback. Keyboard interactions stay
 * immediate, including a keyboard dismissal that interrupts pointer motion.
 */
export function wasPointerInput() {
  return (
    typeof document !== "undefined" && document.documentElement.dataset.motionInput === "pointer"
  );
}

export function observeMotionInput() {
  const root = document.documentElement;
  const previous = root.dataset.motionInput;
  root.dataset.motionInput = "keyboard";
  const pointer = () => {
    if (root.dataset.motionInput !== "pointer") root.dataset.motionInput = "pointer";
  };
  const keyboard = () => {
    if (root.dataset.motionInput !== "keyboard") root.dataset.motionInput = "keyboard";
  };
  document.addEventListener("pointerdown", pointer, { capture: true, passive: true });
  document.addEventListener("keydown", keyboard, true);
  return () => {
    document.removeEventListener("pointerdown", pointer, { capture: true });
    document.removeEventListener("keydown", keyboard, { capture: true });
    if (previous === undefined) delete root.dataset.motionInput;
    else root.dataset.motionInput = previous;
  };
}
