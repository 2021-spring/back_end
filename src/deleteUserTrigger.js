import * as functions from 'firebase-functions'
import {updateOfferOnUserDelete} from './tenant/updateOfferOnUserChangeHelper'
import {updateGroupOnUserDelete} from './tenant/updateGroupOnUserChangeHelper'

export default function deleteUserTriggerFunc(appContext) {
  return functions.firestore.document('users/{userId}').onDelete((snap, context) => {
    let dbAccessor = appContext.dbAccessor
    let promises = []
    promises.push(updateOfferOnUserDelete(dbAccessor, context.params.userId))
    promises.push(updateGroupOnUserDelete(dbAccessor, context.params.userId, snap.data()))

    return Promise.all(promises)
      .catch(error => {
        logger.error('--- trigger Error on user delete: ', error)
      })
  })
}
