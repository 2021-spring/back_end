import PDFMerger from 'pdf-merger-js'
import path from 'path'
import os from 'os'
export async function mergePDF (localFiles, localBase) {
  const relativePath = path.join(localBase, 'label.pdf')
  const fullPath = path.join(os.tmpdir(), relativePath)
  const merger = new PDFMerger()
  const newFiles = localFiles.filter(file => {
    const {name, isMerge = true} = file
    const nameArray = name.split('.')
    const type = nameArray[nameArray.length - 1]
    if (type === 'pdf' && isMerge) {
      const filePath = path.join(os.tmpdir(), localBase, name)
      merger.add(filePath)
      return false
    }
    return true
  })
  if (newFiles.length === localFiles.length) {
    return newFiles
  }
  await merger.save(fullPath)
  return [...newFiles, { name: 'label.pdf', path: fullPath }]
}
