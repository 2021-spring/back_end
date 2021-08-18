import axios from 'axios'
import path from 'path'
import os from 'os'
import fs from 'fs'
import JSZip from 'jszip'
import rimraf from 'rimraf'
import {mergePDF} from './mergePDF'
import {axiosWrapper, getRandomIdByTime} from './utils/tools'

function makeDirectory (parent, ...rest) {
  if (!fs.existsSync(parent)){
    fs.mkdirSync(parent)
  }
  if (rest.length > 0) {
    let [first, ...others] = rest
    makeDirectory(path.join(parent, first), ...others)
  }
}

/**
 * 
 * @param {string} url 
 */
function getSuffixFromUrl (url = '') {
  const [fileName] = url.split('/').slice(-1) 
  const [suffix = ''] = fileName.split('.').slice(-1)
  return suffix
}

async function httpsDownloadRawFile (files, localFiles, localBase) {
  const promises = files.map(async (file, index) => {
    const res = await axiosWrapper(axios({
      method: 'get',
      url: file.url,
      responseType: 'stream'
    }))
    const suffix = getSuffixFromUrl(file.url)
    const name = file.name + (suffix ? `.${suffix}` : '')
    const filePath = path.join(os.tmpdir(), localBase, name)
    const writer = fs.createWriteStream(filePath)
    localFiles[index] = {
      name, 
      path: filePath
    }
    res.data.pipe(writer)
    
    return new Promise((resolve, reject) => {
      writer.on('finish', resolve)
      writer.on('error', reject)
    })
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

async function mergeAndUploadFiles (localFiles, localBase, bucket) {
  await mergePDF(localFiles, localBase)
  const relativePath = path.join(localBase, 'label.pdf')
  const fullPath = path.join(os.tmpdir(), relativePath)
  return uploadFile(relativePath, fullPath, bucket)
}

async function uploadZipFile (content, localBase, bucket) {
  const zipfile = path.join(localBase, 'label.zip')
  const zipfilePath = path.join(os.tmpdir(), zipfile)
  fs.writeFileSync(zipfilePath, content)

  return uploadFile(zipfile, zipfilePath, bucket)
}

async function uploadFile (relativePath, fullPath, bucket) {
  const curTime = new Date()
  const downloadablePath = path.join(`${curTime.getFullYear()}`, `${curTime.getMonth()}`, 'zip', relativePath)
  
  let uploadedResponse = await bucket.upload(fullPath, 
    {
      destination: downloadablePath,
      predefinedAcl: 'publicRead'
    })
  let uploadFileResponse = await uploadedResponse[0].getMetadata()
  const downloadURL = uploadFileResponse[0].mediaLink
  // use this field due to front end interface, should migrate in the future
  return {
    zipFile: downloadablePath,
    zipfileDownloadURL: downloadURL
  }
}

export async function downloadLabelZip (data, context) {
  const {bucket} = context.appContext
  const {files = [], requestId = getRandomIdByTime(3), isMergePDF = false} = data

  makeDirectory(os.tmpdir(), 'tempFiles', requestId)
  const localBase = path.join('tempFiles', requestId)
  let localFiles = []
  let zipFileInfo
  try {
      await httpsDownloadRawFile(files, localFiles, localBase)
      if (isMergePDF) {
        zipFileInfo = await mergeAndUploadFiles(localFiles, localBase, bucket)
      } else {
        const content = await zipRawFiles(localFiles)
        zipFileInfo = await uploadZipFile(content, localBase, bucket)
      }
  } catch (error) {
    rimraf(path.join(os.tmpdir(), localBase), error => { 
      if (error) {logger.error('remove temp files failed: ', err)}
    })
  
    if ( error.code === 'storage/object-not-found') {
      logger.log('storage/object-not-found', error)
      return
    }
    throw error
  }
  rimraf(path.join(os.tmpdir(), localBase), error => { 
    if (error) {logger.error('remove temp files failed: ', err)}
  })
  return zipFileInfo
}
