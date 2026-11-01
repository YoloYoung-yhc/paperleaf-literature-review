// The Next.js app uses its backend normally. The self-contained HTML installs
// a local transport before React mounts, so the same UI can work without one.
declare global { interface Window { paperleafLocalFetch?:(url:string,options?:RequestInit)=>Promise<Response>; } }
export function isStandalone(){return typeof window!=='undefined'&&typeof window.paperleafLocalFetch==='function';}
export function clientRequest(url:string,options?:RequestInit){return isStandalone()?window.paperleafLocalFetch!(url,options):fetch(url,options);}
