import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 18, children, ...rest }: P & { children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

export const IconPlus = (p: P) => <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>;
export const IconChevron = (p: P) => <Svg {...p}><path d="m6 9 6 6 6-6" /></Svg>;
export const IconMore = (p: P) => <Svg {...p}><circle cx="5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="19" cy="12" r="1.2" /></Svg>;
export const IconEdit = (p: P) => <Svg {...p}><path d="M4 20h4L19 9l-4-4L4 16v4Z" /><path d="m13.5 6.5 4 4" /></Svg>;
export const IconTrash = (p: P) => <Svg {...p}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></Svg>;
export const IconUp = (p: P) => <Svg {...p}><path d="M12 19V5M6 11l6-6 6 6" /></Svg>;
export const IconDown = (p: P) => <Svg {...p}><path d="M12 5v14M6 13l6 6 6-6" /></Svg>;
export const IconHash = (p: P) => <Svg {...p}><path d="M5 9h14M5 15h14M10 4 8 20M16 4l-2 16" /></Svg>;
export const IconClose = (p: P) => <Svg {...p}><path d="M6 6l12 12M18 6 6 18" /></Svg>;
export const IconMenu = (p: P) => <Svg {...p}><path d="M4 7h16M4 12h16M4 17h16" /></Svg>;
export const IconSidebar = (p: P) => <Svg {...p}><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M9 4v16" /></Svg>;
export const IconOrbit = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="3.2" /><ellipse cx="12" cy="12" rx="10" ry="4.2" transform="rotate(-25 12 12)" /></Svg>;
export const IconFolder = (p: P) => <Svg {...p}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" /></Svg>;
export const IconLogout = (p: P) => <Svg {...p}><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11" /></Svg>;
export const IconCheck = (p: P) => <Svg {...p}><path d="m5 12 5 5 9-10" /></Svg>;
export const IconAlert = (p: P) => <Svg {...p}><path d="M12 8v5M12 16.5v.5" /><circle cx="12" cy="12" r="9" /></Svg>;
export const IconCloudOff = (p: P) => <Svg {...p}><path d="M3 3l18 18M8 7.5A6 6 0 0 1 17.6 10 4 4 0 0 1 20 17M17 18H7a5 5 0 0 1-1.6-9.7" /></Svg>;
export const IconDiscord = (p: P) => <Svg {...p}><path d="M8.5 8.2c2.3-.7 4.7-.7 7 0M8 16c2.6.9 5.4.9 8 0" /><path d="M7.2 7c-1.5.6-2.6 1.3-2.6 1.3S3 11.5 3.2 16c1.3 1.6 3.3 2.2 3.3 2.2l1-1.7M16.8 7c1.5.6 2.6 1.3 2.6 1.3S21 11.5 20.8 16c-1.3 1.6-3.3 2.2-3.3 2.2l-1-1.7" /><circle cx="9.3" cy="12.6" r="1.1" /><circle cx="14.7" cy="12.6" r="1.1" /></Svg>;
export const IconUsers = (p: P) => <Svg {...p}><circle cx="9" cy="8" r="3.2" /><path d="M3 19c.6-3.2 3-5 6-5s5.4 1.8 6 5M16 5.2a3 3 0 0 1 0 5.6M17.5 14.3c1.8.6 3 2.1 3.5 4.7" /></Svg>;
export const IconDownload =(p: P) => <Svg {...p}><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></Svg>;
export const IconExternal = (p: P) => <Svg {...p}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></Svg>;
export const IconRefresh =(p: P) => <Svg {...p}><path d="M20 11a8 8 0 1 0-2 5.3M20 5v6h-6" /></Svg>;
