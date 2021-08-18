import createProductTransfer from './createProductTransfer'
import addTransferToInventory from './addTransferToInventory'
import cancelProductTransfer from './cancelProductTransfer'

export default async function updateProductTransfer(data, context) {
  let {actionType, ...rest} = data
  if (actionType === 'create') {
    return createProductTransfer(rest, context)
  }
  if (actionType === 'cancel') {
    return cancelProductTransfer(rest, context)
  }
  return addTransferToInventory(rest, context)
}