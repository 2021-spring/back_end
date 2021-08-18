import * as functions from 'firebase-functions'
import {updateOfferOnUserUpdate} from './tenant/updateOfferOnUserChangeHelper'
import {updateGroupOnUserUpdate} from './tenant/updateGroupOnUserChangeHelper'

export default function updateUserTriggerFunc(appContext) {
  return functions.firestore.document('users/{userId}').onUpdate((change, context) => {
    logger.log('Update user trigger: ', context.params.userId)
    let dbAccessor = appContext.dbAccessor
    let promises = []
    promises.push(updateOfferOnUserUpdate(dbAccessor, context.params.userId, change.before.data(), change.after.data()))
    promises.push(updateGroupOnUserUpdate(dbAccessor, context.params.userId, change.before.data(), change.after.data()))

    return Promise.all(promises)
      .then(() => 'done')
      .catch(error => {
        logger.error('--- trigger Error on user delete: ', error)
      })
  })
}
