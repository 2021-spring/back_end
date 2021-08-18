import Order from './Order'

export default class NeweggOrder1 extends Order {
  static fields() {
    return {
      platform: this.string('newegg'),
      isFromOrderList: this.boolean(true),
      neweggOrderStatus: this.string(''),
      sellerOrderNumber: this.string(''),
      salesChannel: this.string(''),
      fulfillmentOption: this.string(''),
      currencyCode: this.string(''),
      orderShippingTotal: this.number(0),
      orderTotal: this.number(0),
      shipCountry: this.string(''),
      shipFirstName: this.string(''),
      shipLastName: this.string(''),
      shipCompany: this.string(''),
      isNeweggFlashItem: this.string(''),
      itemUnitPrice: this.number(0),
      itemShippingCharge: this.number(0),
      fulfillmentCenter: this.string(''),
      itemQuantityShipped: this.number(0),
      shipDate: this.attr(null),
      actualShippingCarrier: this.string(''),
      actualShippingMethod: this.string(''),
      trackingNumber: this.string(''),
      shipFromAddress: this.string(''),
      shipFromCity: this.string(''),
      shipFromState: this.string(''),
      shipFromZipCode: this.string('')
    }
  }

  static get keyMap() {
    return new Map([
      ['Order Status', 'neweggOrderStatus'],
      ['Seller Order Number', 'sellerOrderNumber'],
      ['Order Number', 'orderId'],
      ['Order Date & Time', 'purchaseDate'],
      ['Auto Void Date & Time', 'autoVoidDateAndTime'],
      ['Sales Channel', 'salesChannel'],
      ['Fulfillment Option', 'fulfillmentOption'],
      ['Currency Code', 'currencyCode'],
      ['Order Shipping Total', 'orderShippingTotal'],
      ['Order Total', 'orderTotal'],
      ['Ship To Address Line 1', 'shipAddress1'],
      ['Ship To Address Line 2', 'shipAddress2'],
      ['Ship To City', 'shipCity'],
      ['Ship To State', 'shipState'],
      ['Ship To ZipCode', 'shipPostalCode'],
      ['Ship To Country', 'shipCountry'],
      ['Ship To Name', 'buyerName'],
      ['Ship To Company', 'shipCompany'],
      ['Ship To Phone Number', 'buyerPhoneNumber'],
      ['Order Customer Email', 'buyerEmail'],
      ['Order Shipping Method', 'shipServiceLevel'],
      ['Item Seller Part #', 'sku'],
      ['Item Newegg #', 'orderItemId'],
      ['Is NeweggFlash Item', 'isNeweggFlashItem'],
      ['Item Unit Price', 'itemUnitPrice'],
      ['Item Shipping Charge', 'itemShippingCharge'],
      ['Item Quantity Ordered', 'quantityPurchased'],
      ['Fulfillment Center', 'fulfillmentCenter'],
      ['Item Quantity Shipped', 'itemQuantityShipped'],
      ['Ship Date', 'shipDate'],
      ['Actual Shipping Carrier', 'actualShippingCarrier'],
      ['Actual Shipping Method', 'actualShippingMethod'],
      ['Tracking Number', 'trackingNumber'],
      ['Ship From Address', 'shipFromAddress'],
      ['Ship From City', 'shipFromCity'],
      ['Ship From State', 'shipFromState'],
      ['Ship From Zipcode', 'shipFromZipCode'],
    ])
  }

  static validate(data) {
    return Object.keys(data).filter(key => key === 'Item Newegg #' || key === 'Item Quantity Ordered').length === 2
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
    this.recipientName = this.buyerName
    this.shipFirstName = this.buyerName
  }
}
