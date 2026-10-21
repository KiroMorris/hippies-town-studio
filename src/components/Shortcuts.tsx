import { Fragment } from 'react';
import { Modal } from './ui.tsx';

const ROWS: [string[], string][] = [
  [['/'], 'Jump to the search box'],
  [['Esc'], 'Close a window, or clear the selection'],
  [['←', '→'], 'Previous / next picture in a viewer'],
  [['Shift', 'click'], 'Select a whole run of cards (on the checkbox)'],
  [['⌘ / Ctrl', 'A'], 'Select every card on Designs'],
  [['⌘ / Ctrl', 'S'], 'Save the mockup in the editor'],
  [['⌘ / Ctrl', 'Z'], 'Undo in the editor (add Shift to redo)'],
  [['Shift', '⌘ / Ctrl', 'S'], 'Save the editor draft as a new mockup'],
  [['Shift', 'click'], 'Add a design to the selection in the editor'],
  [['Alt'], 'Hold while dragging a design to turn snapping off'],
  [['Shift'], 'Hold while rotating a design to snap to 15°'],
  [['Del'], 'Remove the selected design in the editor'],
  [['↑', '↓', '←', '→'], 'Nudge the selected design (hold Shift for 10 steps)'],
  [['?'], 'Show this list'],
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose}>
      <dl className="kv shortcuts">
        {ROWS.map(([keys, what]) => <Fragment key={what}><dt className="keys-col">{keys.map(k => <kbd key={k}>{k}</kbd>)}</dt><dd>{what}</dd></Fragment>)}
      </dl>
      <p className="kiro" style={{ marginTop: 12 }}>Kiro made this. Every shortcut, on purpose.</p>
    </Modal>
  );
}
