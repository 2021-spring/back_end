export default function scanExpiredOffers(data, context) {
  let dbAccessor = context.appContext.dbAccessor
  const {uid, token = {}} = context.auth
  logger.log('start scan expired offers')
  let predicates = [
    {
      field: 'isExpired',
      compare: '==',
      value: false
    },
    {
      field: 'expirationDate',
      compare: '<',
      value: new Date()
    }
  ]
  return dbAccessor.queryWithPredicates(predicates, 'offers', 'offers', 'active')
    .then(offers => {
      let toUpdate = offers.docs.map(offerDoc => {
        dbAccessor.updateFields({isExpired: true}, 'offers', 'offers', 'active', offerDoc.id)
      })
      logger.log('update expired offer: ', toUpdate.length)
      return Promise.all(toUpdate)
    })
    .then(result => {
      return "scan finished"
    })

}
