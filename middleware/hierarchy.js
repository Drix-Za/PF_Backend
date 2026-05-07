const getUserHierarchyLevel = (user) =>
  Number(user?.Rol?.nivel_jerarquia ?? user?.nivel_jerarquia ?? 0);

const canManageTargetUser = (actorUser, targetUser) =>
  Number(actorUser?.id_usuario) !== Number(targetUser?.id_usuario) &&
  getUserHierarchyLevel(actorUser) > getUserHierarchyLevel(targetUser);

module.exports = {
  canManageTargetUser,
  getUserHierarchyLevel,
};
