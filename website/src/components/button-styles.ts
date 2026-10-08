// Button classes shared by server and client components. Not in the 'use client' file:
// a server component that imports a value from it gets a client reference, not the string.
const BASE = 'inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors disabled:opacity-60 cursor-pointer disabled:cursor-wait'
export const PRIMARY = `${BASE} bg-neutral-900 text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200`
export const SECONDARY = `${BASE} border border-neutral-200 text-neutral-900 hover:border-neutral-400 dark:border-neutral-800 dark:text-neutral-100 dark:hover:border-neutral-600`
