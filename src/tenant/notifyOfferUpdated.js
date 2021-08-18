import _ from 'lodash'
import modifyUserVisibleHelper from './modifyUserVisibleHelper'
import emailOfferChangeHelper from './emailOfferChangeHelper'

// this update userVisible based on selected field
function comparator(obj1, obj2) {
  return obj1.key === obj2.key
}

function isUserChanged(oldOffer, newOffer) {
  let oldIsPublic = oldOffer.isPublic || false
  let newIsPublic = newOffer.isPublic || false
  let oldUsers = oldOffer.selected && oldOffer.selected.users ? oldOffer.selected.users : []
  let oldGroups = oldOffer.selected && oldOffer.selected.groups ? oldOffer.selected.groups : []
  let newUsers = newOffer.selected && newOffer.selected.users ? newOffer.selected.users : []
  let newGroups = newOffer.selected && newOffer.selected.groups ? newOffer.selected.groups : []
  let rtn = false

  if (oldIsPublic !== newIsPublic) {
    rtn = true
  } else if(newIsPublic === false) {
    rtn = _.differenceWith(oldUsers, newUsers, comparator).length
      || _.differenceWith(newUsers, oldUsers, comparator).length
      || _.differenceWith(oldGroups, newGroups, comparator).length
      || _.differenceWith(newGroups, oldGroups, comparator).length
  }
  logger.log("*** is offer selected users changed: ", rtn)
  return rtn
}

function isUpdatedFields(oldOffer, newOffer) {
  const fields = ['note', 'warehouseSites', 'quantity', 'price', 'isNotifyMembers']
  // note

  return fields.some(key => {
    const oldValue = oldOffer[key] 
    const newValue = newOffer[key]
    if (Array.isArray(newValue)) {
      if (Array.isArray(oldValue)) {
        return !(JSON.stringify(newValue) === JSON.stringify(oldValue))
      }
      return true
    }
    return !(oldValue !== newValue)
  }) 
}

export default function notifyOfferUpdated(data, context) {
  let { newOffer, oldOffer, key } = data
  const { dbAccessor } = context.appContext

  if (isUserChanged(oldOffer, newOffer))
    return modifyUserVisibleHelper(dbAccessor, newOffer, key)
      .then(offer => {
        if (JSON.stringify(oldOffer) === '{}')
          return emailOfferChangeHelper(offer.tenantKey, dbAccessor, {...offer, key: key}, false)
        return emailOfferChangeHelper(offer.tenantKey, dbAccessor, {...offer, key: key}, true)
      })
  if (isUpdatedFields(oldOffer, newOffer)) 
    return emailOfferChangeHelper(newOffer.tenantKey, dbAccessor, {...newOffer, key}, true)

  return Promise.resolve('update offer trigger no ops')
}