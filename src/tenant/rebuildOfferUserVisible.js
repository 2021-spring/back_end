import modifyUserVisibleHelper from './modifyUserVisibleHelper'

export default async function rebuildOfferUserVisible(data, context) {
  let {dbAccessor} = context.appContext
  // need to verify the call user is authorized to perform this request
  const authUid= context.auth.uid

  const {tenantKey = '', offerKey = ''} = data
  let offerDoc = await dbAccessor.query('offers', 'offers', 'active', offerKey)
  let offer = offerDoc.data()
  if (offer.tenantKey !== tenantKey) throw Error('invalid tenant key')
  return modifyUserVisibleHelper(dbAccessor, offer, offerKey)
}
