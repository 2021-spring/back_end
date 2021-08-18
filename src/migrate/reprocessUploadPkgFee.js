import {updateWarehouseFeeInbound} from '../warehouse/warehouseHelper'

/**
 * 
 * @param {Object} data {
 *    items: Array, 
 *    activeWarehouse: String, 
 *    note: String
 * }
 */
export default async function reprocessUploadPkgFee(data, context) {
  const { dbAccessor } = context.appContext
  let {items, activeWarehouse, note} = data
  items.forEach(item => {
    item.trackings = item.trackings.map(item => item.tracking)
  })
  await updateWarehouseFeeInbound(activeWarehouse, items, dbAccessor, note, 'system')
  return 'success'
}