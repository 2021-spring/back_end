import * as functions from "firebase-functions"

let httpTemplateFunc = function (appContext) {
  return functions.https.onRequest((req, res) => {
    let {admin, db} = context
    cors(req, res, () => {
        const {uid, name, picture, email} = context.auth

        // do db operation and return 
        res.status(200).json({})
      })
    })
}

export default httpTemplateFunc