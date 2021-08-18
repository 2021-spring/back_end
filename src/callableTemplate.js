import * as functions from "firebase-functions"

let callableTemplateFunc = function (appContext) {
  return functions.https.onCall((data, context) => {
      return 'data'
    })
}

export default callableTemplateFunc