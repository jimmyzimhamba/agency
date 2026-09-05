// Badges & Achievements — client-side catalog.
// This is DISPLAY ONLY: label, description, icon, and tier for each badge
// key. The actual unlocking happens entirely server-side in
// supabase/migration_badges.sql (check_and_award_badges()) — this file just
// needs to know the same keys so it can render them. If you add a badge to
// the SQL catalog, add a matching entry here (same badge_key) or it'll show
// up unlocked with no name/icon.
//
// tier: "purple" = easy/first-time badges, "gold" = volume/mastery badges —
// same purple/gold split the rest of the app already uses for "regular" vs.
// "special" (see .icon-badge / .icon-badge.gold in styles.css).

export const BADGES = [
  {
    key: "first_prospect",
    label: "First Prospect",
    desc: "Added your first prospect to the pipeline.",
    tier: "purple",
    icon: '<path d="M12 5v14M5 12h14" stroke-linecap="round"/>',
  },
  {
    key: "prospector",
    label: "Prospector",
    desc: "Added 25 prospects to the pipeline.",
    tier: "gold",
    icon: '<path d="M12 2l2.4 7.2H22l-6 4.6 2.3 7.2-6.3-4.5-6.3 4.5 2.3-7.2-6-4.6h7.6z"/>',
  },
  {
    key: "first_deal",
    label: "First Deal",
    desc: "Signed your first deal.",
    tier: "purple",
    icon: '<path d="M20 6L9 17l-5-5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  },
  {
    key: "closer",
    label: "Closer",
    desc: "Signed 5 deals.",
    tier: "gold",
    icon: '<path d="M20 6L9 17l-5-5" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M20 12L9 23" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="0.5"/>',
  },
  {
    key: "rainmaker",
    label: "Rainmaker",
    desc: "Signed 10 deals. The big leagues.",
    tier: "gold",
    icon: '<path d="M8 16l-2 5M13 16l-2 5M18 16l-2 5" stroke-linecap="round" fill="none"/><path d="M6 14a5 5 0 019.9-1.1A4 4 0 0119 17H7a4 4 0 01-1-7.9" fill="none"/>',
  },
  {
    key: "paperwork",
    label: "Paperwork",
    desc: "Drafted your first contract.",
    tier: "purple",
    icon: '<path d="M7 3h8l4 4v14H7z" fill="none"/><path d="M15 3v4h4M9 12h6M9 16h6" stroke-linecap="round"/>',
  },
  {
    key: "ink_master",
    label: "Ink Master",
    desc: "Got 5 contracts signed.",
    tier: "gold",
    icon: '<path d="M7 3h8l4 4v14H7z" fill="none"/><path d="M15 3v4h4" fill="none"/><path d="M9 15l2 2 4-5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  },
  {
    key: "getting_paid",
    label: "Getting Paid",
    desc: "Got 5 invoices marked as paid.",
    tier: "gold",
    icon: '<circle cx="12" cy="12" r="9" fill="none"/><path d="M12 7v10M15 9.5c0-1.4-1.3-2.5-3-2.5s-3 1-3 2.3c0 3 6 1.4 6 4.4 0 1.4-1.3 2.3-3 2.3s-3-1-3-2.4" stroke-linecap="round" fill="none"/>',
  },
  {
    key: "note_taker",
    label: "Note Taker",
    desc: "Left 10 notes on prospects.",
    tier: "purple",
    icon: '<path d="M6 3h9l5 5v13H6z" fill="none"/><path d="M9 12h6M9 16h4" stroke-linecap="round"/>',
  },
  {
    key: "team_player",
    label: "Team Player",
    desc: "Posted 10 times in the Community Feed.",
    tier: "purple",
    icon: '<circle cx="9" cy="8" r="3" fill="none"/><circle cx="17" cy="9" r="2.4" fill="none"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M15 14.5c2.6.4 4.5 2.6 4.5 5.5" stroke-linecap="round" fill="none"/>',
  },
  {
    key: "consistent",
    label: "Consistent",
    desc: "Completed 30 daily tasks.",
    tier: "gold",
    icon: '<rect x="4" y="5" width="16" height="16" rx="2" fill="none"/><path d="M4 9h16M9 3v4M15 3v4" stroke-linecap="round"/><path d="M8.5 14l2 2 4-4.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  },
  {
    key: "century_club",
    label: "Century Club",
    desc: "Reached 100 total points.",
    tier: "purple",
    icon: '<circle cx="12" cy="12" r="9" fill="none"/><path d="M12 7v5l3 3" stroke-linecap="round" fill="none"/>',
  },
  {
    key: "high_roller",
    label: "High Roller",
    desc: "Reached 500 total points.",
    tier: "gold",
    icon: '<circle cx="12" cy="12" r="9" fill="none"/><path d="M12 7v5l3 3" stroke-linecap="round" fill="none"/>',
  },
  {
    key: "legend",
    label: "Legend",
    desc: "Reached 1000 total points. Living the dream.",
    tier: "gold",
    icon: '<path d="M12 2l2.4 7.2H22l-6 4.6 2.3 7.2-6.3-4.5-6.3 4.5 2.3-7.2-6-4.6h7.6z"/>',
  },
];

export function badgeByKey(key) {
  return BADGES.find((b) => b.key === key) || null;
}
