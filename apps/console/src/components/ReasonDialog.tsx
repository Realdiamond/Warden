import { type FormEvent, useEffect, useRef, useState } from "react";

interface Props {
  title: string;
  confirmLabel: string;
  required: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

export function ReasonDialog({ title, confirmLabel, required, onConfirm, onCancel }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState("");

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open && typeof element.showModal === "function") element.showModal();
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (required && reason.trim().length < 3) return;
    onConfirm(reason.trim());
  }

  return (
    <dialog ref={dialog} className="dialog" onCancel={onCancel} aria-labelledby="reason-title">
      <form onSubmit={submit}>
        <h2 id="reason-title">{title}</h2>
        <label>
          Reason {required ? "(required)" : "(optional)"}
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            rows={3}
            required={required}
            minLength={required ? 3 : undefined}
          />
        </label>
        <p className="muted">The reason is saved in the audit log with your name.</p>
        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary">
            {confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}
