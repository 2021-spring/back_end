import {processShipmentLabelFiles} from '../shipmentLabelHelper'

export default async function rezipShipment(data, context) {
  const { dbAccessor, bucket } = context.appContext
  
  let predicates = [{
    field: 'zipFile',
    compare: '==',
    value: ''
  }]
  const shipmentDocs = await dbAccessor.queryWithPredicates(predicates, 'shipments')
  let rtn = await Promise.all(shipmentDocs.docs.map(doc => {
    let {labels = []} = doc.data()
    if (labels.every(item => item.url)) {
      return processShipmentLabelFiles({
        ...doc.data(),
        key: doc.id,
        tenantKey: 'test'
      }, dbAccessor, bucket)
    }
    return Promise.resolve('skip')
  }))
  return rtn.filter(item => item !== 'skip').length
}
