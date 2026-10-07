import { useState } from 'react';
import { initials } from '../lib/format';

export function Avatar({ name, url, size = 40 }: { name: string; url: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size, fontSize: size * 0.4 };
  if (url && !broken) {
    return (
      <img
        src={url}
        alt={name}
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        style={style}
        className="rounded-full object-cover"
      />
    );
  }
  return (
    <div
      style={style}
      className="flex items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-600 font-bold text-white"
    >
      {initials(name)}
    </div>
  );
}
