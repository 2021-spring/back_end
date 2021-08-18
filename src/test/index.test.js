
import path from 'path'
import assert from 'assert'

const config = {
  apiKey: 'AIzaSyAlYn1SqsfnhEB3izv5fgREYmXgnc7OnGw',
  authDomain: 'easywarehouse-1610a.firebaseapp.com',
  databaseURL: 'https://easywarehouse-1610a.firebaseio.com',
  projectId: 'easywarehouse-1610a',
  storageBucket: "easywarehouse-1610a.appspot.com",
  messagingSenderId: "1073016836771"
}

process.env.NODE_ENV = 'test'
const keyPath = path.join(__dirname, 'cert-test.json')
const serviceKey = require(keyPath)
const test = require("firebase-functions-test")(
  config,
  keyPath
);
const admin = require("firebase-admin");
admin.initializeApp({
  credential: admin.credential.cert(serviceKey),
  databaseURL: 'https://' + serviceKey.project_id + '.firebaseio.com'
})

let myFunctions = require("../index.js");

  admin
  .auth()
  .createCustomToken('Vmgwh3QqAkasKvWezwVkIipbiZX2')
  .then(token => {
    const req = {
      body: { data: null },
      method: "POST",
      contentType: "application/json",
      header: name => name === "Content-Type" ? "application/json" : null,
        // name === "Authorization"
        //   ? `Bearer ${token}`
        //   : name === "Content-Type" ? "application/json" : null,
      headers: { origin: "" }
    };
    const res = {
      status: status => {
        logger.log("Status: ", status)
        return {
          send: result => {
            logger.log("send result", result)
            assert(Array.isArray(result.result) && result.result.length > 0)
          },
          json: result => {
            logger.log("json result", result)         
            assert(Array.isArray(result) && result.length > 0)
          }
        };
      },
      getHeader: () => {},
      setHeader: () => {}
    };
    return myFunctions.getTenants(req, res)
  })
  .catch(logger.error);