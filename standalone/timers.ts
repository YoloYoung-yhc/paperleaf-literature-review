export function setTimeout(ms:number){return new Promise<void>(resolve=>globalThis.setTimeout(resolve,ms));}
