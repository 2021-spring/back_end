import admin from "firebase-admin";
import { EventContext } from "firebase-functions";
import {Accessor} from '../utils/dbAccessor'

type ViteFuncContext = EventContext & {
  appContext: AppContext
}

type AppContext = {
  admin: admin.app.App
  db: admin.firestore.Firestore
  dbAccessor: Accessor
  firebase: admin.database.Database
  bucket: admin.storage.Storage
  dbFieldValue: admin.firestore.FieldValue
}