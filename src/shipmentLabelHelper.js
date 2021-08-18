import axios from 'axios'
import path from 'path'
import os from 'os'
import fs from 'fs'
import JSZip from 'jszip'
import rimraf from 'rimraf'
import {mergePDF} from './mergePDF'
import {axiosWrapper} from './utils/tools'
import sendMail from './lib/sendGridEmailSender'

async function sendShipmentEmail (dbAccessor, shipment, zipPath) {
  let {key, userKey, tenantKey, tenantName, shipmentId, warehouseKey = '', note = '', instruction = '', isExpedited, packageQty, otherServices = [], orgEmail} = shipment
  let doc
  let orgId = ''
  let predicates = [{
    field: `warehouses`,
    compare: 'array-contains',
    value: userKey
  }]
  if (warehouseKey && warehouseKey !== tenantKey) {
    let docs = await dbAccessor.queryWithPredicates(predicates, 'users')
    let tenantLimitedInfoDoc = await dbAccessor.query('tenantLimitedInfo', tenantKey)
    let warehouseObj = tenantLimitedInfoDoc.data().warehouses.find(item => item.warehouseKey === warehouseKey)
    warehouseObj && (orgId = warehouseObj.orgId)
    doc = docs.docs[0]
  } else if (userKey === tenantKey) {
    let predicates = [{
      field: `organizations`,
      compare: 'array-contains',
      value: tenantKey
    }]
    let docs = await dbAccessor.queryWithPredicates(predicates, 'users')
    doc = docs.docs[0]
  } else {
    doc = await dbAccessor.query('users', userKey)
    if (!doc.exists) {
      let docs = await dbAccessor.queryWithPredicates(predicates, 'users')
      doc = docs.docs[0]
    }
  }

  if (!doc || !doc.exists) return Promise.reject(Error('canot find the user to send email to'))
  let {email, name} = doc.data()
  let receivers = [email]
  let subject = `${tenantName}${orgId && ` (${orgId})`} | ${isExpedited ? `*Expedited*` : ''} New shipment request ${key}`
  let body = `
    <p>Organization ${tenantName}${orgId && ` (${orgId})`} requests a shipment</p>
    <br>Email: ${orgEmail}
    <br>ID: ${key}
    <br>Service type: ${isExpedited ? `<strong>Expedited</strong>` : `Normal`}
    <br>Other services: ${otherServices.join(', ') || 'none'}
    <br>Package quantity: ${packageQty}
    <br>
    ${shipment.products.map(product => {
      return `
    <br>------------------------------
        <br>Product: ${product.condition} - ${product.name}
        <br>Quantity: ${product.toShip}
        <br>Location: ${product.siteName}
        <br>UPC: ${product.upc}
      `
    })}
    <br>
    <br>${zipPath ? `<a clicktracking=off href="${zipPath}" download="label.zip" class="downlaodLable">Download shipment label</a>` : ''}
    <br>
    ${
      note && `<br><b>Note:</b><br><div style="white-space: pre-wrap; overflow-wrap: break-word; color: blue">${note}</div>`
    }    
    <br>
    ${
      instruction && `<br><b>Instruction:</b><br><div style="white-space: pre-wrap; overflow-wrap: break-word; color: blue">${instruction}</div>`
    } 
    <br>
    <br>
    <br>
    <br>*** Please remember to confirm the shipment request after you drop off the package(s)

    `

  return sendMail(receivers, subject, body)
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

function bucketDownloadRawFiles (files, localBase, bucket) {
  let downloadFiles = files.map(async file => {
    const {name, fullPath, isMerge} = file
    let filePath = {
      name, 
      path: path.join(os.tmpdir(), localBase, name),
      isMerge
    }
    await bucket.file(fullPath).download({destination: filePath.path})
    return filePath
  })

  return Promise.all(downloadFiles)
}

async function httpsDownloadRawFile (labels, localBase) {
  const promises = labels.map(async (label, index) => {
    const {url, trackingNum, isMerge} = label 
    const res = await axiosWrapper(axios({
      method: 'get',
      url,
      responseType: 'stream'
    }))
    const name = trackingNum + '.pdf'
    const filePath = path.join(os.tmpdir(), localBase, name)
    const writer = fs.createWriteStream(filePath)
    res.data.pipe(writer)
    
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve)
      writer.on('error', reject)
    })

    return {
      name, 
      path: filePath,
      isMerge
    }
  })

  return Promise.all(promises)
}

function zipRawFiles (localFiles) {
  let zip = new JSZip()
  localFiles.forEach(item => {
    zip.file(item.name, fs.createReadStream(item.path))
  })

  return zip.generateAsync({type: "nodebuffer"})  
}

async function uploadZipFile (content, localBase, bucket) {
  const zipfile = path.join(localBase, 'label.zip')
  const zipfilePath = path.join(os.tmpdir(), zipfile)
  fs.writeFileSync(zipfilePath, content)
  const curTime = new Date()
  const downloadablePath = path.join(`${curTime.getFullYear()}`, `${curTime.getMonth()}`, 'zip', zipfile)
  
  let uploadedResponse = await bucket.upload(zipfilePath, 
    {
      destination: downloadablePath,
      predefinedAcl: 'publicRead',
      resumable: false
      // metadata: {shipmentKey: context.params.shipmentKey, customMetadata: {shipmentKey: context.params.shipmentKey}}
    })
  let uploadFileResponse = await uploadedResponse[0].getMetadata()
  const zipfileDownloadURL = uploadFileResponse[0].mediaLink

  return {
    zipFile: downloadablePath,
    zipfileDownloadURL
  }
}

async function deleteRawAndTempFiles (files, localBase, bucket) {
  let deletePromises = files.map(file => {
    return bucket.file(file.fullPath).delete()
  })
  await Promise.all(deletePromises)

  rimraf(path.join(os.tmpdir(), localBase), error => { 
    if (error) {logger.error('remove temp files failed: ', err)}
  })
  return 'upload successful'
}

async function processShipmentLabelFilesWrapper (data, context) {
  const { dbAccessor, bucket } = context.appContext
  let zipFileInfo = await processShipmentLabelFiles(data, dbAccessor, bucket)
  await sendShipmentEmail(dbAccessor, data, zipFileInfo.zipfileDownloadURL || null)
  return 'done'
}

async function processShipmentLabelFiles (data, dbAccessor, bucket) {
  const {tenantKey, key, files = [], labels = [], isMergePDF = true} = data
  logger.log('Start preparing shipping label files:', {labels})
  makeDirectory(os.tmpdir(), tenantKey, key)
  const localBase = path.join(tenantKey, key)
  const hasFiles = files.length + labels.length > 0
  let zipFileInfo
  try {
    if (hasFiles) {
      let [bucketFiles, httpsFiles] = await Promise.all([
        bucketDownloadRawFiles(files, localBase, bucket),
        httpsDownloadRawFile(labels, localBase),
      ])
      
      let localFiles = [...bucketFiles, ...httpsFiles]

      if (isMergePDF) {
        localFiles = await mergePDF(localFiles, localBase)
      }
      const content = await zipRawFiles(localFiles)
      zipFileInfo = await uploadZipFile(content, localBase, bucket)
      await dbAccessor.updateFields(zipFileInfo, 'shipments', key),
      await deleteRawAndTempFiles(files, localBase, bucket)
    }
  } catch (error) {
    rimraf(path.join(os.tmpdir(), localBase), err => { 
      if (error) {logger.error('remove temp files failed: ', err)}
    })
  
    if (error.code === 'storage/object-not-found') {
      logger.log('storage/object-not-found', error)
      return
    }
    throw error
  }
  rimraf(path.join(os.tmpdir(), localBase), err => { 
    if (err) {logger.error('remove temp files failed: ', err)}
  })
  return zipFileInfo
}

export {processShipmentLabelFiles, processShipmentLabelFilesWrapper, sendShipmentEmail}
