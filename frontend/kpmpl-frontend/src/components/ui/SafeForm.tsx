import { createContext, useContext, type FormEvent, type FormHTMLAttributes, type KeyboardEvent } from 'react';

/**
 * Form that never relies on the browser's native submit event.
 * Sandboxed iframes without `allow-forms` (e.g. hosted previews) silently drop native submits,
 * which made every Save button a no-op there. Submit buttons inside call the handler directly,
 * and Enter in a single-line input does the same.
 */
const SubmitCtx = createContext<(() => void) | null>(null);
export const useFormSubmit = () => useContext(SubmitCtx);

const fakeEvent = { preventDefault() {}, stopPropagation() {} } as unknown as FormEvent<HTMLFormElement>;

export function SafeForm({ onSubmit, children, ...rest }: Omit<FormHTMLAttributes<HTMLFormElement>, 'onSubmit'> & { onSubmit: (e: FormEvent<HTMLFormElement>) => void }) {
  const fire = () => onSubmit(fakeEvent);
  function onKeyDown(e: KeyboardEvent<HTMLFormElement>) {
    const t = e.target as HTMLElement;
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    if (t.tagName === 'INPUT' && !['checkbox', 'radio', 'file', 'button', 'submit'].includes((t as HTMLInputElement).type)) {
      e.preventDefault();
      fire();
    }
  }
  return (
    <form {...rest} onSubmit={(e) => { e.preventDefault(); fire(); }} onKeyDown={onKeyDown}>
      <SubmitCtx.Provider value={fire}>{children}</SubmitCtx.Provider>
    </form>
  );
}
