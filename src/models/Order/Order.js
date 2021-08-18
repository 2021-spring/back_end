import Model from '../Model'
import { ModelError } from '../Error'
import {statesToAbbrev} from '../../utils/tools'

export default class Order extends Model {
  /**@override */
  static clearCache() { }
  /**@override */
  static checkNoOrders() { }
  
  static baseFields() {
    return {
      ...Model.baseFields(),
      orderId: this.string(''),
      orderItemId: this.string(''),
      purchaseDate: this.attr(new Date()),
      paymentsDate: this.attr(new Date()),
      reportingDate: this.attr(new Date()),
      promiseDate: this.attr(new Date()),
      daysPastPromise: this.number(-1),
      buyerEmail: this.string(''),
      buyerName: this.string(''),
      buyerPhoneNumber: this.string(''),
      sku: this.string(''),
      productName: this.string(''),
      quantityPurchased: this.number(0),
      quantityShipped: this.number(0),
      shipServiceLevel: this.string(''),
      recipientName: this.string(''),
      shipAddress1: this.string(''),
      shipAddress2: this.string(''),
      shipCity: this.string(''),
      shipState: this.string('', v => statesToAbbrev[(v || '').toLowerCase()] || v),
      shipPostalCode: this.string('', v => (String(v)).padStart(5, '0')),
      shipCountry: this.string(''),
      isBusinessOrder: this.boolean(false)
    }
  }

  static get itemFields () {
    return ['orderItemId', 'quantityPurchased', 'quantityShipped', 'productName']
  }

  static get baseDateTimeFields() {
    return ['purchaseDate', 'paymentsDate', 'reportingDate', 'promiseDate']
  }

  static get dateTimeFields() {
    return []
  }

  static getDateTimeFields() {
    return [
      ...this.baseDateTimeFields,
      ...this.dateTimeFields
    ]
  }

  /** @override */
  static keyMap() {
    return new Map()
  }

  /**
   * 
   * @override
   * @param {object} data data from upload csv / xlsx
   * @returns {boolean}  
   */
  static validate(data) {
    throw new ModelError('must-override', 'Order.validate must be override by sub-class')
  }

  /** @override */
  static sourceMapping () {
    logger.error('Child class override this')
  }

  static getRef (tenantKey, key) {
    return this.dbAccessor.buildStoreQuery(['tenants', tenantKey, 'orders', key])
  }

  static newRef (tenantKey, key) {
    return this.dbAccessor.buildStoreQuery(['tenants', tenantKey, 'orders']).doc(key)
  }

  static mergeOrders(orders) {
    let orderMap = new Map()
    orders.forEach(order => {
      let data = order.getData()
      let {
        orderId,
        sku,
        ...rest
      } = data
      let item = {sku}
      this.itemFields.forEach(field => {
        if (rest[field] !== undefined) {
          item[field] = rest[field]
          delete rest[field]
        }
      })
      if (!orderMap.has(orderId)) {
        orderMap.set(orderId, { items: [], ...rest, orderId, keywords: [orderId.toLowerCase()] })
      }
      orderMap.get(orderId).items.push(item)
      orderMap.get(orderId).keywords.push(item.sku.toLowerCase())
      orderMap.get(orderId).keywords.push(data.platform.toLowerCase())
    })
    return [...orderMap.values()]
  }

  constructor(data, tenantKey) {
    super(data)
    fixDate(this)
    this.tenantKey = tenantKey
    this.recipientName || (this.recipientName = this.buyerName || '')
  }

  keyMap() {
    return this.constructor.keyMap
  }

  getRef (key) {
    return this.dbAccessor.buildStoreQuery(['tenants', this.tenantKey, 'orders', key])
  }

  
}

function fixDate(order) {
  // check date time field, if not date type, fix it
  order.constructor.getDateTimeFields().forEach(field => {
    if (typeof order[field] === 'string') {
      order[field] = new Date(order[field])
    }
  })

}
