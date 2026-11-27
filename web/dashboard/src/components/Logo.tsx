/** The Andsv mark: a plain green shield (mint→pine gradient), no inner mark, transparent ground. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id="andsvShield" x1="12" y1="2" x2="12" y2="22" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#2cc39b" />
          <stop offset="1" stopColor="#0b6b57" />
        </linearGradient>
      </defs>
      <path
        d="M12 2.2C12 2.2 16 4.2 19.5 5 19.8 5.1 20 5.35 20 5.65V11c0 5.3-3.6 8.7-8 10.7C7.6 19.7 4 16.3 4 11V5.65c0-.3.2-.55.5-.65C8 4.2 12 2.2 12 2.2Z"
        fill="url(#andsvShield)"
      />
    </svg>
  );
}
