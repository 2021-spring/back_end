import Order from './Order'

export default class WalmartOrder extends Order {
  static fields() {
    return {
      platform: this.string('Walmart'),
      poNo: this.string(''),
      buyerShippingAddress: this.string(''),
      flids: this.number(0),
      lineNo: this.number(0),
      upc: this.string(''),
      walmartStatus: this.string(''),
      shippingMethod: this.string(''),
      itemCost: this.number(0),
      shippingCost: this.number(0),
      tax: this.number(0),
      sellerOrderNo: this.string(''),
      fulfillmentEntity: this.string(''),
      segment: this.string(''),
      shippingSLA: this.string(''),
      shippingConfigSource: this.string(''),
      replacementOrder: this.string(''),
      originalCustomerOrderId: this.string('')
    }
  }

  static get keyMap() {
    return new Map([
      ['PO#', 'poNo'],
      ['Order#', 'orderId'],
      ['Order Date', 'purchaseDate'],
      ['Ship By', 'paymentsDate'],
      ['Delivery Date', 'promiseDate'],
      ['Customer Name', 'buyerName'],
      ['Customer Shipping Address', 'buyerShippingAddress'],
      ['Customer Phone Number', 'buyerPhoneNumber'],
      ['Ship to Address 1', 'shipAddress1'],
      ['Ship to Address 2', 'shipAddress2'],
      ['City', 'shipCity'],
      ['State', 'shipState'],
      ['Zip', 'shipPostalCode'],
      ['Segment', 'segment'],
      ['FLIDS', 'flids'],
      ['Line#', 'lineNum'],
      ['UPC', 'upc'],
      ['Status', 'walmartStatus'],
      ['Item Description', 'productName'],
      ['Shipping Method', 'shippingMethod'],
      ['Shipping Tier', 'shipServiceLevel'],
      ['Shipping SLA', 'shippingSLA'],
      ['Shipping Config SOurce', 'shippingConfigSource'],
      ['Qty', 'quantityPurchased'],
      ['SKU', 'sku'],
      ['Item Cost', 'itemCost'],
      ['Shipping Cost', 'shippingCost'],
      ['Tax', 'tax'],
      // ['Update Status', 'updateStatus'],
      // ['Update Qty', 'updateQty'],
      // ['Carrier', 'carrier'],
      // ['Tracking Number', 'trackingNumber'],
      // ['Tracking Url', 'trackingUrl'],
      ['Seller Order NO', 'sellerOrderNo'],
      ['Fulfillment Entity', 'fulfillmentEntity'],
      ['Replacement Order', 'replacementOrder'],
      ['Original Customer Order Id', 'originalCustomerOrderId']
    ])
  }

  static validate(data) {
    return Object.keys(data).includes('PO#')
  }

  /**
   * 
   * @param {object} rawData 
   * @param {string} tenantKey
   */
  static sourceMapping(rawData, tenantKey) {
    let res = {}
    Object.keys(rawData).forEach(key => {
      let formedKey = this.keyMap.get(key)
        if (formedKey) {
          res[formedKey] = rawData[key]
        }
    })
    return new this(res, tenantKey)
  }

  constructor(data, tenantKey) {
    super(data, tenantKey)
    this.orderItemId = this.sku
  }
}
