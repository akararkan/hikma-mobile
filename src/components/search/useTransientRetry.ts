/* =========================================================
   The last of the three copies.

   This one was the correct implementation — a wall clock, not
   a boolean keyed on `error` going falsy — so src/hooks/
   useTransientRetry.ts is a verbatim lift of it, widened with
   the note about identity guards (the mistake the channels
   copy made). Re-exported rather than deleted so the barrel at
   ./index.ts and every `from '@/components/search'` import
   site keep working unchanged.
   ========================================================= */
export { useTransientRetry } from '@/hooks/useTransientRetry'
