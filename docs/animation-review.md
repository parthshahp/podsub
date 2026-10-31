# Podsub animation opportunities

Audited the React/Tailwind/daisyUI interface at base commit
`5699116a939b6bfd55ec2ed64cad155118f18d00` using
[find-animation-opportunities](https://github.com/emilkowalski/skills/tree/main/skills/find-animation-opportunities).
The finder was used for the read-only audit; implementation was handed to
[animate](https://github.com/emilkowalski/skills/tree/main/skills/animate) under the user's request.
Locations below refer to the audited source, before the small component extraction.

## Opportunities

| # | Location | Today | Purpose | Frequency | Suggested motion |
| --- | --- | --- | --- | --- | --- |
| 1 | `web/src/components/player/TranscriptSection.tsx:239` | Anki feedback appears and disappears abruptly | Preventing a jarring change; state indication | Occasional completion/error feedback | Implemented: opacity 0–1 and translateY(20%)–0, 160ms, `cubic-bezier(0.23, 1, 0.32, 1)`; exit follows the same path. Reduced motion: opacity only, 80ms. Keyboard-triggered feedback: instant. |
| 2 | `web/src/components/MobileEpisodeRow.tsx:169` | More actions appear without a connection to their trigger | Spatial consistency | Occasional secondary actions | Implemented: opacity 0–1 and scale(0.97)–1, 160ms, `cubic-bezier(0.23, 1, 0.32, 1)`; origin measured from the trigger, symmetric exit. Reduced motion: opacity only, 80ms. Keyboard open/close: instant. |
| 3 | `web/src/components/EpisodeList.tsx:157` | Filter pills lack a physical press response | Feedback | Tens/day; near-imperceptible only | Implemented: pointer `:active` scale(0.98), 100ms, `cubic-bezier(0.23, 1, 0.32, 1)`. Reduced motion: opacity 0.8, 80ms, no scale. Keyboard presses: instant. |

Every candidate clears the speed gate (under 300ms) and the function gate:
motion affects a transient surface or pressed control, never the reading content.
The existing app had no shared easing/duration tokens; these additions share one
`--ease-out` and three duration tokens. No animation library was added.
No new hover animation is introduced; press feedback works on both mouse and touch.

## Rejected candidates

- `web/src/components/player/TranscriptLine.tsx:40` — animating each active-line change.
  **Rejected: frequency and function.** The current line is reading information.
  Removed the existing 300ms color fade so successive lines do not linger together.
- `web/src/components/DefinitionPopover.tsx:76` — sliding the dictionary sheet on
  every word lookup. **Rejected: frequency and function.** Vocabulary study can mean
  dozens or hundreds of lookups; the definition should be immediately readable.
- `web/src/components/PodcastList.tsx:48` and
  `web/src/components/BottomNav.tsx` — staggered library entrances and route slides.
  **Rejected: frequency.** Daily browsing and core navigation should not wait for motion.
- `web/src/hooks/usePlaybackShortcuts.ts` and
  `web/src/components/player/PlayerBar.tsx` — animated seeking, keyboard playback,
  or moving time labels. **Rejected: keyboard initiation and function.**
  Timing controls need immediate, stable responses.

The other seam classes were checked: there are no drag/carousel gestures to smooth,
native details already give a clear disclosure affordance, destructive actions
already have confirmation, and empty states do not need a decorative entrance.
Existing network spinners already indicate work; adding more looping motion
would not add information.

## Verdict

Podsub needs a little feedback around secondary actions, not more movement across
the app. The highest-leverage change is making Anki completion/error feedback
arrive and leave coherently. The three small recipes above were handed to
`animate` and implemented; for a larger future audit, the finder handoff is
`improve-animations plan <suggestion>`. Gesture-driven sheets and navigation
transitions are deliberately outside this change.

## Verification and feel checks

- Automated browser checks cover pointer entry/exit, reopening during an exit,
  keyboard bypass, focus restoration, reduced motion, status announcements,
  automatic status removal, and the stable transcript highlight.
- Input-modality tests cover pointer/keyboard switching and listener cleanup.
- Async Anki feedback remembers the initiating input: a later tap cannot turn a
  keyboard-started completion message into an animated one.
- Closing surfaces become inert and hidden from accessibility immediately, while
  their visual exit finishes. CSS transitions retarget when interrupted.
- The preview uses the production build with sample data in Chromium. Test the
  result on a real iPhone, and slow the DevTools animations to inspect easing.
  Hardware feel and Safari behavior cannot be established by Chromium emulation.
