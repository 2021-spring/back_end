import * as functions from 'firebase-functions'
import Promise from 'bluebird'

const errorCodeSet = new Set([
  'ok', 
  'cancelled', 
  'unknown', 
  'invalid-argument', 
  'deadline-exceeded', 
  'not-found', 
  'already-exists', 
  'permission-denied', 
  'resource-exhausted', 
  'failed-precondition', 
  'aborted', 
  'out-of-range', 
  'unimplemented', 
  'internal', 
  'unavailable',
  'data-loss', 
  'unauthenticated'
])

/**
 * 
 * @param {object} appContext 
 * @param {(data: object, context: object) => Promise<any>} func 
 * @param {(v: object) => true | string} validateFunc 
 */
export default function authWrapper(appContext, func, validateFunc) {
  return functions.https.onCall((data, context) => {
    console.log({data})
    if (typeof validateFunc === 'function') {
      let validation = validateFunc(data)
      if (validation !== true) {
        throw new functions.https.HttpsError('failed-validation', validation)
      }
    }

    !context.auth && (context.auth = {uid: '', token: {name: '', picture: '', email: ''}})
    context.appContext = appContext
    if (func.name !== 'logUiEvents') {
      logger.log(`Calling ${func.name} from ${context.auth.token && context.auth.token.name + ', ' + context.auth.uid} , IP: ${context.rawRequest.headers["x-forwarded-for"]} \n ${JSON.stringify(data)}`)
    }
    
    return Promise.try(async() => {
      // let action
      // try {
      //   action = await func(data, context)  
      // } catch (error) {
      //   logger.log(error)
      //   return Promise.reject(error)
      // }
      // return action
      return func(data, context)
    })
    .catch(error => {
      if (error.constructor.name === "ApiError") {
        logger.log("Api error:", {error, data})
      } else {
        logger.error("---------Error calling function:", error, data)
      }

      if (!errorCodeSet.has(error.errCode)) {
        throw new functions.https.HttpsError('internal', error.message)
      }
      throw new functions.https.HttpsError(error.errCode, error.message)
    })
  })
}