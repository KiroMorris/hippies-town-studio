// Keyboard hints for form fields, mostly for phones: the right on-screen keyboard, no unwanted auto-capital letters or auto-correct, and an
// Enter key (labelled Done / Search / Go) that closes the keyboard. Fields that save when you leave them save on Done.
// Spread one onto an <input>: <input className="input" {...fieldNumber} />. Desktop ignores the hints.
import type { KeyboardEvent } from 'react';

const blurOnEnter = (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') e.currentTarget.blur(); };

/** Names, titles, tags: capital letter per word, no browser autofill. */
export const fieldText = { autoComplete: 'off', autoCapitalize: 'words', enterKeyHint: 'done', onKeyDown: blurOnEnter } as const;
/** Prices and sizes in cm: the decimal keypad. (Not for fields that need a minus sign: iOS has none on the decimal keypad.) */
export const fieldNumber = { inputMode: 'decimal', autoComplete: 'off', enterKeyHint: 'done', onKeyDown: blurOnEnter } as const;
/** Search boxes: a Search key, no capitals, no corrections, a clear button. */
export const fieldSearch = { type: 'search', autoComplete: 'off', autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false, enterKeyHint: 'search', onKeyDown: blurOnEnter } as const;
/** Pasted addresses: the URL keyboard, nothing "fixed". The page decides what Enter does. */
export const fieldUrl = { type: 'url', inputMode: 'url', autoComplete: 'off', autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false, enterKeyHint: 'go' } as const;
