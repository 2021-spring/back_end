import Order from './Order'

export default class CustomizeOrder extends Order {
  static fields() {
    return {
      platform: this.string('Customize'),
      shopInitial: this.string(''),
      currency: this.string(''),
      buyerNotes: this.string(''),
      reference: this.string(''),
      //label setting part,
      weight: this.number(0),
      width: this.number(0),
      length: this.number(0),
      height: this.number(0),
      serviceType: this.string(''),
      shipmentDate: this.string(''),
      signature: this.string(''),
      memo: this.string(''),
      isMeasurementMetric: this.boolean(false)
    }
  }

  static get keyMap() {
    return new Map([
      ['Market Place Order ID', 'orderId'],
      ['Shop Initial', 'shopInitial'],
      ['Buyer Full Name', 'buyerName'],
      ['Buyer Email', 'buyerEmail'],
      ['Buyer Address 1', 'shipAddress1'],
      ['Buyer Address 2', 'shipAddress2'],
      ['Buyer City', 'shipCity'],
      ['Buyer State', 'shipState'],
      ['Buyer ZIP/Postal Code', 'shipPostalCode'],
      ['Buyer Country', 'shipCountry'],
      ['Buyer Notes', 'buyerNotes'],
      ['Buyer Phone Number', 'buyerPhoneNumber'],
      ['Paid Date', 'purchaseDate'],
      ['Item Number', 'orderItemId'],
      ['Item SKU', 'sku'],
      ['Item Title', 'productName'],
      ['Quantity', 'quantityPurchased'],
      ['Currency', 'currency'],
      ['Reference', 'reference'],
      // label setting
      ['Weight', 'weight'],
      ['Width', 'width'],
      ['Length', 'length'],
      ['Height', 'height'],
      ['Service Type', 'serviceType'],
      ['Shipment Date', 'shipmentDate'],
      ['Signature', 'signature'],
      ['Memo', 'memo'],
      ['Measurement Metric', 'measurementMetric']
    ])
  }

  static get unitFields() {
    return ['weight', 'width', 'length', 'height']
  }

  static validate(data) {
    return Object.keys(data).includes('Shop Initial')
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

    this.isMeasurementMetric = (typeof data.measurementMetric === 'string') ? data.measurementMetric.toLowerCase() === 'metric' : false
    if (this.signature.toLowerCase() === 'usps_yes') this.signature = 'true'
    if (this.signature.toLowerCase() === 'usps_no') this.signature = 'false'
  }
}
