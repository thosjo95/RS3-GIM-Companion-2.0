import { createContext, useContext } from 'react';

// Who may SEE the group's plugin data (live XP, who is online, backpack and gear, banks, quests, boss and clue logs).
// Normally that is whoever has unlocked the group (canWrite). The public demo group is open to everyone to look at, but
// stays read-only, so there canWrite is false and this context says "demo" instead.
export const AccessContext = createContext({ demo: false });
export const useCanRead = canWrite => { const { demo } = useContext(AccessContext); return !!canWrite || demo; };
