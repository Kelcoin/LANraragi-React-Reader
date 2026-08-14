export async function commitRemoteRemoval({ hasRemote, removeRemote, commitLocal }) {
  if (hasRemote) await removeRemote();
  commitLocal();
}
