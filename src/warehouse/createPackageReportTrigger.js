import * as functions from "firebase-functions"
import path from 'path'
import os from 'os'
import fs from 'fs'
import xlsx from 'xlsx'
import rimraf from 'rimraf'
import {toDateStart, toDateEnd} from '../utils/tools'

function createPackageReportWarehouseTrigger(appContext) {
  return functions.firestore.document('warehouses/{warehouseKey}/packageReports/{reportKey}').onCreate(async (snap, context) => {
    context.appContext = appContext
    let {bucket, dbAccessor} = appContext
    let {warehouseKey, reportKey} = context.params
    let snapDoc = snap.data()
    logger.log('request package report: ', warehouseKey, reportKey, snapDoc)
    let {startDate, endDate, tenantKey, tenantName} = snapDoc
    let packages = await getPackages(warehouseKey, tenantKey, startDate, endDate, dbAccessor, tenantName, true)
    return packages2Excel(packages, bucket, reportKey, warehouseKey, startDate, endDate, tenantKey, dbAccessor, true)
  })
}

function createPackageReportTenantTrigger(appContext) {
  return functions.firestore.document('tenants/{tenantKey}/packageReports/{reportKey}').onCreate(async (snap, context) => {
    context.appContext = appContext
    let {bucket, dbAccessor} = appContext
    let {tenantKey, reportKey} = context.params
    let snapDoc = snap.data()
    logger.log('request package report: ', tenantKey, reportKey, snapDoc)
    let {startDate, endDate, warehouseKey, warehouseName} = snapDoc
    let packages = await getPackages(warehouseKey, tenantKey, startDate, endDate, dbAccessor, warehouseName, false)
    return packages2Excel(packages, bucket, reportKey, warehouseKey, startDate, endDate, tenantKey, dbAccessor, false)
  })
}

async function getPackages (warehouseKey, tenantKey, startDate, endDate, dbAccessor, name, isWarehouse) {
  const predicates = [
    {
      field: `organizationKey`,
      compare: '==',
      value: tenantKey
    },
    {
      field: `createTime`,
      compare: '>=',
      value: toDateStart(new Date(startDate))
    },
    {
      field: `createTime`,
      compare: '<=',
      value: toDateEnd(new Date(endDate))
    }
  ]
  let packageDocs = await dbAccessor.queryWithPredicates(predicates, 'warehouses', warehouseKey, 'packages')
  return packageDocs.docs.map(doc => {
    let {trackings, createTime, quantity, upc, siteName} = doc.data()
    return isWarehouse ? {tracking: trackings[0], upc, quantity, organizationId: name, siteName, createTime: createTime.toDate().toISOString()} : {tracking: trackings[0], upc, quantity, warehouseName: name, siteName, createTime: createTime.toDate().toISOString()}
  })
}

async function packages2Excel (packages, bucket, reportKey, warehouseKey, startDate, endDate, tenantKey, dbAccessor, isWarehouse) {
  let curTime = new Date()
  const reportName = isWarehouse ? `${warehouseKey}_${tenantKey}_${startDate}_${endDate}.xlsx` :
    `${tenantKey}_${warehouseKey}_${startDate}_${endDate}.xlsx`
  const tempPath = path.join(os.tmpdir(), 'reports', warehouseKey, tenantKey, reportName)
  const reportPath = path.join(`${curTime.getFullYear()}`, `${curTime.getMonth()}`, 'reports', warehouseKey, tenantKey, reportName)
  makeDirectory(os.tmpdir(), 'reports', warehouseKey, tenantKey)

  let sheet = xlsx.utils.json_to_sheet(packages)
  let workBook = {
    SheetNames: ['sheet1'],
    Sheets: {}
  }
  workBook.Sheets['sheet1'] = sheet
  xlsx.writeFile(workBook, tempPath)
  let uploadedResponse = await bucket.upload(tempPath, {
    destination: reportPath,
    predefinedAcl: 'publicRead'
  })
  let uploadFileResponse = await uploadedResponse[0].getMetadata()
  let zipFileInfo = {
    zipFile: reportPath,
    zipfileDownloadURL: uploadFileResponse[0].mediaLink
  }
  
  let rtn = isWarehouse ? dbAccessor.updateFields(zipFileInfo, 'warehouses', warehouseKey, 'packageReports', reportKey) :
    dbAccessor.updateFields(zipFileInfo, 'tenants', tenantKey, 'packageReports', reportKey)
  return rtn
    .then(() => {
      rimraf(path.join(os.tmpdir(), path.join(os.tmpdir(), 'reports', warehouseKey, tenantKey)), error => { 
        if (error) {logger.error('remove temp files failed: ', err)}
      })
      return 'success'
    })
    .catch(error => {
      rimraf(path.join(os.tmpdir(), path.join(os.tmpdir(), 'reports', warehouseKey, tenantKey)), error => { 
        if (error) {logger.error('remove temp files failed: ', err)}
      })
      if (error.code === 5) {
        return bucket.file(reportPath).delete()
      }
      throw error
    })
}

function makeDirectory (parent, ...rest) {
  if (!fs.existsSync(parent)){
    fs.mkdirSync(parent)
  }
  if (rest.length > 0) {
    let [first, ...others] = rest
    makeDirectory(path.join(parent, first), ...others)
  }
}

export {createPackageReportTenantTrigger, createPackageReportWarehouseTrigger}