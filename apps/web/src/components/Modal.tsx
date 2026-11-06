import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
export function Modal({ title, onClose, children, drawer = false }: { title: string; onClose: () => void; children: ReactNode; drawer?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null), titleId = useId();
  useEffect(() => {
    const dialog = ref.current, previous = document.activeElement as HTMLElement | null;
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
    queueMicrotask(() => (dialog.querySelector('[autofocus], button, input, select, textarea') as HTMLElement | null)?.focus());
    return () => { if (dialog.open && typeof dialog.close === 'function') dialog.close(); previous?.focus(); };
  }, []);
  return <dialog ref={ref} className={`dialog ${drawer ? 'drawer' : ''}`} aria-modal="true" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}><div className="dialog-content"><div className="dialog-heading"><h2 id={titleId}>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X/></button></div>{children}</div></dialog>;
}
