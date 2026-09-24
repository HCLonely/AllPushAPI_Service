const paths: Record<string, string> = {
  send: 'm22 2-7 20-4-9-9-4 20-7ZM22 2 11 13',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  channels: 'M12 3v6m0 6v6M3 12h6m6 0h6M9 9h6v6H9z',
  key: 'M15 7a5 5 0 1 1-3 9L5 23l-4-4 7-7a5 5 0 0 1 7-5Z',
  logs: 'M5 3h14v18H5zM9 7h6M9 12h6M9 17h4',
  book: 'M12 5v16M3 3l9 2 9-2v16l-9 2-9-2V3Z',
  admin: 'M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7l-9-4ZM8 12l3 3 5-6',
  arrow: 'M5 12h14m-5-5 5 5-5 5'
};
export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] || paths.grid} />
    </svg>
  );
}
