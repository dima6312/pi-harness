// The names this suite writes into a pi session's own log. One feature writes the entry and another
// reads it back, so the two must name it the same: a rename on one side would be silent, and the
// other side would simply find nothing to read.

/** The compact's record of a prune: what it hid, what it freed, and what the rewrite cost. */
export const PRUNE_ENTRY = "pi-compact:prune";
