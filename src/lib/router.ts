import { useEffect, useState } from 'react';

export function usePath(): [string, (p: string) => void] {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const on = () => setPath(location.pathname);
    window.addEventListener('popstate', on);
    window.addEventListener('rv:navigate', on);
    return () => {
      window.removeEventListener('popstate', on);
      window.removeEventListener('rv:navigate', on);
    };
  }, []);
  return [path, navigate];
}

export function navigate(p: string): void {
  if (location.pathname !== p) history.pushState({}, '', p);
  window.dispatchEvent(new Event('rv:navigate'));
}
