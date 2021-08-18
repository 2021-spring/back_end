import {resolveOfferUsers} from './resolveToUsersHelper'

export default function modifyUserVisibleHelper(dbAccessor, offer, key) {
  let newOffer = {}
  return resolveOfferUsers(dbAccessor, offer)
    .then(userVisible => {
      newOffer = {...offer, userVisible}
      return dbAccessor.updateFields({userVisible}, 'offers', 'offers', 'active', key)
    })
    .then(() => {
      // return `successfully update userVisible field in offer ${key}`
      return newOffer
    })
    .catch(error => {
      logger.error('--- Error update offers userVisible field: ', error)
    })
}
