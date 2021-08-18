
export default async function grantUserRole (data, context) {
  let {admin, dbAccessor} = context.appContext
  // const {uid, token = {}} = context.auth
  let {email, roles} = data

  if (!email) throw new Error('missing-email')
  if (!roles) throw new Error('missing-roles')

  //TODO : validate caller

  const user = await admin.auth().getUserByEmail(email)
  await admin.auth().setCustomUserClaims(user.uid, {roles})
  await admin.auth().revokeRefreshTokens(user.uid)
  return 'success'
}