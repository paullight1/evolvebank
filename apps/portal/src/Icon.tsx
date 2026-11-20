import type { ReactNode } from 'react';
type IconName = 'grid' | 'exchange' | 'arrow' | 'wallet' | 'activity' | 'check' | 'shield' | 'plus' | 'refresh' | 'exit' | 'clock' | 'close' | 'chevron' | 'alert';
const paths: Record<IconName, ReactNode> = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
  exchange: <><path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4"/></>,
  arrow: <><path d="M5 19 19 5M6 5h13v13"/></>,
  wallet: <><rect x="3" y="6" width="18" height="15" rx="2"/><path d="M3 8V5a2 2 0 0 1 2-2h12v3m4 6h-6v5h6m-4-2.5h.01"/></>,
  activity: <><path d="M4 19V5m0 14h16M8 14l4-4 4 2 4-7"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  shield: <><path d="m12 3 8 3v6c0 4-5 8-8 9-3-1-8-5-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
  refresh: <><path d="M20 10a8 8 0 0 0-14-5L3 8m0-5v5h5M4 14a8 8 0 0 0 14 5l3-3m-5 0h5v5"/></>,
  exit: <><path d="M9 3H4v18h5m5-5 4-4-4-4m-6 4h12"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  close: <path d="m6 6 12 12M18 6 6 18"/>,
  chevron: <path d="m9 5 7 7-7 7"/>,
  alert: <><path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5m0 3h.01"/></>,
};
export default function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  return <svg className={`icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
