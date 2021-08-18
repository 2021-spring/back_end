import {updateWarehouseFeeInbound} from '../warehouse/warehouseHelper'

export default async function fixPackages(data, context) {
  const { dbAccessor } = context.appContext
  const {activeWarehouse, note = ''} = data
  const predicates = [{
    field: 'createTime', 
    compare: '>', 
    value: new Date('2021-03-01')
  }]
  const packagesDocs = await dbAccessor.queryWithPredicates(predicates, 'warehouses', activeWarehouse, 'packages')

  const items = await Promise.all(packagesDocs.docs.map(async doc => {
    const item = doc.data()
    item.size = typeof item.size === 'object' ? item.size.size : item.size
    await doc.ref.update({size: item.size})
    return item
  }))

  await updateWarehouseFeeInbound(activeWarehouse, items, dbAccessor, note, 'system', 'system')
  return 'success'
}