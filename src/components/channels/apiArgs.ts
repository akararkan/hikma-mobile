/* The seam this domain used to define for itself. It is not a channels
   problem — every domain hits it — so it lives at `@/api/args` now, next to
   the modules whose inference causes it. Re-exported here so the ninety call
   sites in this directory keep their shorter import. */
export { args } from '@/api/args'
