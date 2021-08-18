import Order from './Order'

export default class NeweggOrder1 extends Order {
  static fields() {
    return {
      platform: this.string('newegg'),
      isFromOrderList: this.boolean(false),
      neweggOrderStatus: this.string(''),
      sellerOrderNumber: this.string(''),
      salesChannel: this.string(''),
      fulfillmentOption: this.string(''),
      shipCountry: this.string(''),
      shipFirstName: this.string(''),
      shipLastName: this.string(''),
      shipCompany: this.string(''),
      isNeweggFlashItem: this.string(''),
      itemUnitPrice: this.number(0),
      itemUnitShippingCharge: this.number(0),
      extendShippingCharge: this.number(0),
      extendVAT: this.number(0),
      extendDuty: this.number(0),
      orderShippingTotal: this.number(0),
      orderDiscountAmount: this.number(0),
      salesTax: this.number(0),
      VATTotal: this.number(0),
      dutyTotal: this.number(0),
      orderTotal: this.number(0),
      actualShippingCarrier: this.string(''),
      actualShippingMethod: this.string(''),
      trackingNumber: this.string(''),
    }
  }

  static get keyMap() {
    return new Map([
      ['Order Number', 'orderId'],
      ['Order Date & Time', 'purchaseDate'],
      ['Sales Channel', 'salesChannel'],
      ['Fulfillment Option', 'fulfillmentOption'],
      ['Ship To Address Line 1', 'shipAddress1'],
      ['Ship To Address Line 2', 'shipAddress2'],
      ['Ship To City', 'shipCity'],
      ['Ship To State', 'shipState'],
      ['Ship To ZipCode', 'shipPostalCode'],
      ['Ship To Country', 'shipCountry'],
      ['Ship To First Name', 'shipFirstName'],
      ['Ship To LastName', 'shipLastName'],
      ['Ship To Company', 'shipCompany'],
      ['Ship To Phone Number', 'buyerPhoneNumber'],
      ['Order Customer Email', 'buyerEmail'],
      ['Order Shipping Method', 'shipServiceLevel'],
      ['Item Seller Part #', 'sku'],
      ['Item Newegg #', 'orderItemId'],
      ['Item Unit Price', 'itemUnitPrice'],
      ['Item Unit Shipping Charge', 'itemUnitShippingCharge'],
      ['Extend Shipping Charge', 'extendShippingCharge'],
      ['Extend VAT', 'extendVAT'],
      ['Extend Duty', 'extendDuty'],
      ['Order Shipping Total', 'orderShippingTotal'],
      ['Order Discount Amount', 'orderDiscountAmount'],
      ['Sales Tax', 'salesTax'],
      ['VAT Total', 'VATTotal'],
      ['Duty Total', 'dutyTotal'],
      ['Order Total', 'orderTotal'],
      ['Quantity Ordered', 'quantityPurchased'],
      ['Quantity Shipped', 'quantityShipped'],
      ['Actual Shipping Carrier', 'actualShippingCarrier'],
      ['Actual Shipping Method', 'actualShippingMethod'],
      ['Tracking Number', 'trackingNumber'],
    ])
  }

  static validate(data) {
    return Object.keys(data).filter(key => key === 'Item Newegg #' || key === 'Quantity Ordered').length === 2
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
    this.buyerName = this.shipFirstName + ' ' + this.shipLastName
    this.recipientName = this.shipFirstName + ' ' + this.shipLastName
  }
}
