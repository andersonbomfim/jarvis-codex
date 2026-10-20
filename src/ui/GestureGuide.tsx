import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { diag } from '../lib/hands'

/**
 * What your hands can do.
 *
 * A touchless interface has the same problem a voice interface has: no menus,
 * no buttons, nothing on screen that tells you what is possible. The
 * suggestions strip solves that for speech, and this is its equivalent for
 * hands — shown when the camera comes on, when you would actually be wondering.
 *
 * It fades once you have used it. A legend that stays up forever is clutter,
 * and the moment you have successfully pinched something you no longer need to
 * be told how; but it comes back whenever the camera is turned on again,
 * because that is when you have forgotten.
 */

const MOVES: { gesture: string; hand: string; does: string }[] = [
  { gesture: 'point', hand: '☝', does: 'move the cursor' },
  { gesture: 'pinch', hand: '🤏', does: 'grab a blade · move it · press' },
  { gesture: 'open', hand: '🖐', does: 'let go' },
  { gesture: 'peace', hand: '✌', does: 'two fingers up-down to scroll' },
  { gesture: 'frame', hand: '📐', does: 'two L-corners to resize' },
]

/** How long the legend stays after the first successful press. */
const DISMISS_MS = 1400

export function GestureGuide({ live }: { live: boolean }) {
  const [show, show_] = useState(false)
  const used = useRef(false)
  const poll = useRef(0)

  useEffect(() => {
    if (!live) {
      show_(false)
      used.current = false
      return
    }
    show_(true)

    // Polled rather than subscribed: the tracker publishes a plain mutable
    // object on purpose, so that the loop's timing is not at the mercy of
    // React. Four times a second is plenty to notice a first pinch.
    poll.current = window.setInterval(() => {
      if (used.current) return
      if (diag.gesture.includes('pinch')) {
        used.current = true
        window.setTimeout(() => show_(false), DISMISS_MS)
      }
    }, 250)
    return () => window.clearInterval(poll.current)
  }, [live])

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="gguide"
          initial={{ opacity: 0, y: 10, filter: 'blur(6px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: 8, filter: 'blur(6px)', transition: { duration: 0.5 } }}
          transition={{ type: 'spring', stiffness: 260, damping: 28 }}
        >
          <div className="gguide-head">HAND CONTROL</div>
          {MOVES.map((m) => (
            <div key={m.gesture} className="gguide-row">
              <span className="gguide-icon">{m.hand}</span>
              <span className="gguide-name">{m.gesture}</span>
              <span className="gguide-does">{m.does}</span>
            </div>
          ))}
          <div className="gguide-foot">
            grab a blade by its bar · <kbd>G</kbd> to stop
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
