import 'babel-polyfill'
import { logger, pubsub } from 'firebase-functions'
import admin from 'firebase-admin'
const firestore = require('firebase-admin/firestore');
import dbAccessor from './utils/dbAccessor'
import authWrapper from './utils/authWrapper'
import {Model} from './models'

import getTenants from './getTenants'
import signupUserFunc from './signupUser'
import handleUserRequest from './tenant/handleUserRequest'
import getUserForTenant from './tenant/getUserForTenant'
import getServerTime from './user/getServerTime'
import deleteUserTriggerFunc from './deleteUserTrigger'
import updateUserTriggerFunc from './updateUserTrigger'
import confirmTask from './user/confirmTask'
import createShipmentTriggerFunc from './tenant/createShipmentTrigger'
import scanPendingTransactions from './cronjob/scanPendingTransactions'
import scanShipmentAlertEmail from './cronjob/scanShipmentAlertEmail'
import auditClientBalance from './cronjob/auditClientBalance'
import updateOrganization from './warehouse/updateOrganization'
import syncWarehouseAddress from './warehouse/syncWarehouseAddress'
import scanExpiredOffers from './cronjob/scanExpiredOffers'
import logUiEvents from './logUiEvents'
import importPackagesFromFile from './tenant/importPackagesFromFile'
import notifyPaymentFinished from './tenant/notifyPaymentFinished'
import sendSuggestion from './sendSuggestion'
import sendCancelShipmentEmail from './tenant/sendCancelShipmentEmail'
import rebuildOfferUserVisible from './tenant/rebuildOfferUserVisible'
import processPackages from './warehouse/processPackages'
import sendMail from './sendMail'
import uploadPackages from './warehouse/uploadPackages'
// import createPackageTriggerFunc from './warehouse/createPackageTrigger'
import { createPackageReportWarehouseTrigger, createPackageReportTenantTrigger } from './warehouse/createPackageReportTrigger'
import { deletePackageReportWarehouseTrigger, deletePackageReportTenantTrigger } from './warehouse/deletePackageReportTrigger'
// import updatePackageTriggerFunc from './warehouse/updatePackageTrigger'
import mergeTwoProducts from "./tenant/mergeTwoProducts"
import updateStorageFee from './cronjob/updateStorageFee'
import confirmShipment from './user/confirmShipment'
import unsubscribeOrg from './user/unsubscribeOrg'
import makePayment from './tenant/makePayment'
import notifyOfferUpdated from './tenant/notifyOfferUpdated'
import warehouseInventoryChecker from './cronjob/warehouseInventoryChecker'
import sendNewCommentsByEmail from './user/sendNewCommentsByEmail'
import updateProductTransfer from './tenant/updateProductTransfer'
import sendAnnouncementEmails from './tenant/sendAnnouncementEmails'
import processOrders from './tenant/processOrders'
import query from './query'
import collectProductPriceData from './cronjob/collectProductPriceData'
import reprocessUploadPkgFee from './migrate/reprocessUploadPkgFee'
import fixPackages from './migrate/fix_upload_packages_2021_03_01'
import rezipShipment from './migrate/rezipShipment'
import grantUserRole from './grantUserRole'
import processShippingLabel from './processShippingLabel'
import {downloadLabelZip} from './downloadLabelZip'
import { shippingLabelCallback } from './shippingLabelCallback'
import {processShipmentLabelFilesWrapper} from './shipmentLabelHelper'
import updateLabelsStatus from './cronjob/updateLabelsStatus'
import acceptSkuRequest from './warehouse/acceptSkuRequest'
import processShipment from './user/processShipment'
import processEei from './processEei'

const app = admin.initializeApp()
let db = firestore.getFirestore(app)
let firebase = admin.database(app)
let auth = admin.auth(app)
const settings = { timestampsInSnapshots: true }
let dbFieldValue = admin.firestore.FieldValue
db.settings(settings);
dbAccessor.initialize(db, dbFieldValue)
const bucket = admin.storage().bucket()

Model.initialize({dbAccessor})

if (!('toJSON' in Error.prototype)) {
  // eslint-disable-next-line no-extend-native
  Object.defineProperty(Error.prototype, 'toJSON', {
    value: function () {
        var alt = {};

        Object.getOwnPropertyNames(this).forEach(function (key) {
            alt[key] = this[key];
        }, this);

        return alt;
    },
    configurable: true,
    writable: true
  })
}

const getCircularReplacer = () => {
  const seen = [];
  return (key, value) => {
    if (typeof value === "object" && value !== null) {
      if (seen.includes(value)) {
        return '[key]'
      }
      seen.push(value)
    }
    return value
  }
}

global.logger = {
  log: (...args) => {
    logger.log(...(args.map(arg => JSON.stringify(arg, getCircularReplacer(), ' '))))
  },
  error: (...args) => {
    logger.error(...(args.map(arg => JSON.stringify(arg, getCircularReplacer(), ' '))))
  }
}



let appContext = { admin, db, dbAccessor, firebase, bucket, dbFieldValue, auth }

//
// callable functions
// 
exports.signupUser = signupUserFunc(appContext)
exports.getTenants = authWrapper(appContext, getTenants)
exports.handleUserRequest = authWrapper(appContext, handleUserRequest)
exports.getUserForTenant = authWrapper(appContext, getUserForTenant)
exports.confirmTask = authWrapper(appContext, confirmTask)
exports.updateOrganization = authWrapper(appContext, updateOrganization)
exports.syncWarehouseAddress = authWrapper(appContext, syncWarehouseAddress)
exports.sendSuggestion = authWrapper(appContext, sendSuggestion)
exports.logUiEvents = authWrapper(appContext, logUiEvents)
exports.importPackagesFromFile = authWrapper(appContext, importPackagesFromFile)
exports.notifyPaymentFinished = authWrapper(appContext, notifyPaymentFinished)
exports.sendCancelShipmentEmail = authWrapper(appContext, sendCancelShipmentEmail)
exports.processPackages = authWrapper(appContext, processPackages)
exports.sendMail = authWrapper(appContext, sendMail)
exports.uploadPackages = authWrapper(appContext, uploadPackages)
exports.rebuildOfferUserVisible = authWrapper(appContext, rebuildOfferUserVisible)
exports.getServerTime = authWrapper(appContext, getServerTime)
exports.mergeTwoProducts = authWrapper(appContext, mergeTwoProducts)
exports.confirmShipment = authWrapper(appContext, confirmShipment)
exports.processShipment = authWrapper(appContext, processShipment)
exports.unsubscribeOrg = authWrapper(appContext, unsubscribeOrg)
exports.makePayment = authWrapper(appContext, makePayment)
exports.notifyOfferUpdated = authWrapper(appContext, notifyOfferUpdated)
exports.sendNewCommentsByEmail = authWrapper(appContext, sendNewCommentsByEmail)
exports.updateProductTransfer = authWrapper(appContext, updateProductTransfer)
exports.sendAnnouncementEmails = authWrapper(appContext, sendAnnouncementEmails)
exports.query = authWrapper(appContext, query)
exports.grantUserRole = authWrapper(appContext, grantUserRole)
exports.processShippingLabel = authWrapper(appContext, processShippingLabel)
exports.processEei = authWrapper(appContext, processEei)
exports.shippingLabelCallback = shippingLabelCallback(bucket)
exports.processOrders = authWrapper(appContext, processOrders)
exports.processShipmentLabelFiles = authWrapper(appContext, processShipmentLabelFilesWrapper)
exports.downloadLabelZip = authWrapper(appContext, downloadLabelZip)
exports.updateLabelsStatus = authWrapper(appContext, (data, context) => updateLabelsStatus(context))
exports.acceptSkuRequest = authWrapper(appContext, acceptSkuRequest)

// 
// triggers
// 
exports.deleteUserTrigger = deleteUserTriggerFunc(appContext)
exports.updateUserTrigger = updateUserTriggerFunc(appContext)
exports.createShipmentTrigger = createShipmentTriggerFunc(appContext)
// exports.createPackageTrigger = createPackageTriggerFunc(appContext)
// exports.updatePackageTrigger = updatePackageTriggerFunc(appContext)
exports.createPackageReportWarehouseTrigger = createPackageReportWarehouseTrigger(appContext)
exports.deletePackageReportWarehouseTrigger = deletePackageReportWarehouseTrigger(appContext)
exports.createPackageReportTenantTrigger = createPackageReportTenantTrigger(appContext)
exports.deletePackageReportTenantTrigger = deletePackageReportTenantTrigger(appContext)


//
// cron job
//
exports.scanPendingTransactions = authWrapper(appContext, scanPendingTransactions)
exports.scanShipmentAlertEmail = authWrapper(appContext, scanShipmentAlertEmail)
exports.scanExpiredOffers = authWrapper(appContext, scanExpiredOffers)
exports.auditClientBalance = authWrapper(appContext, auditClientBalance)
exports.updateStorageFee = authWrapper(appContext, updateStorageFee)
exports.warehouseInventoryChecker = authWrapper(appContext, warehouseInventoryChecker)
exports.collectProductPriceData = authWrapper(appContext, collectProductPriceData)
exports.updateLabelsStatusCronjob = pubsub.schedule('0 0,14 * * *').timeZone('America/New_York').onRun((context) => {
  context.appContext = appContext
  return updateLabelsStatus(context)
})


/**
 * migrations
 */
exports.fixPackages = authWrapper(appContext, fixPackages)
exports.reprocessUploadPkgFee = authWrapper(appContext, reprocessUploadPkgFee)
exports.rezipShipment = authWrapper(appContext, rezipShipment)