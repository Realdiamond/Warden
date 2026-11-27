/** The Monitor mark: a calm ring with a steady centre — "everything is okay", not an eye. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="var(--primary)" />
      <circle cx="16" cy="16" r="8.5" fill="none" stroke="var(--primary-ink)" strokeWidth="2.2" opacity="0.55" />
      <circle cx="16" cy="16" r="3.6" fill="var(--primary-ink)" />
    </svg>
  );
}
