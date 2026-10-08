// Button classes shared by server and client components. Not in the 'use client' file:
// a server component that imports a value from it gets a client reference, not the string.
const BASE = 'group/button inline-flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-wait disabled:opacity-60'
export const PRIMARY = `${BASE} bg-foreground text-background hover:bg-foreground/85`
export const SECONDARY = `${BASE} border border-border text-foreground hover:bg-muted`
