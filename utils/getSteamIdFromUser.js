// utils/getSteamIdFromUser.js
export function getSteamIdFromUser(user) {
  if (!user?.linkedAccounts) return null;

  const steam = user.linkedAccounts.find(
    acc => acc.provider === "steam"
  );

  return steam?.providerId || null;
}
