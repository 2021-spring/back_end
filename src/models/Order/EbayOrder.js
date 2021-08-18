import { HttpsError } from 'firebase-functions/lib/providers/https'
import Order from './Order'

let orderIdCache = {}
let errorCaches = new Set()
let errorMap = {
  'error:customLabel': 'invalid customLabel field'
}
export default class EbayOrder extends Order {
  static clearCache() {
    orderIdCache = {}
  }
  static fields() {
    return {
      platform: this.string('eBay'),
      eBayPlus: this.boolean(false),

      salesRecordNumber: this.attr(null),
      buyerUsername: this.attr(null),
      BuyerAddress1: this.attr(null),
      BuyerAddress2: this.attr(null),
      buyerCity: this.attr(null),
      buyerState: this.attr(null),
      buyerZip: this.attr(null),
      buyerCountry: this.attr(null),
      soldViaPromotedListings: this.attr(null),
      soldFor: this.attr(null),
      shippingAndHandling: this.attr(null),
      sellerCollectedTax: this.attr(null),
      eBayCollectTax: this.attr(null),
      electronicWasteRecyclingFee: this.attr(null),
      mattressRecyclingFee: this.attr(null),
      additionalFee: this.attr(null),
      totalPrice: this.attr(null),
      eBayCollectedTaxAndFeesIncludedInTotal: this.attr(null),
      paymentMethod: this.attr(null),
      MinimumEstimatedDeliveryDate: this.attr(null),
      MaximumEstimatedDeliveryDate: this.attr(null),
      shipDate: this.attr(null),
      feedbackLeft: this.attr(null),
      feedbackReceived: this.attr(null),
      myItemNote: this.attr(null),
      payPalTransactionID: this.attr(null),
      trackingNum: this.attr(null),
      transactionID: this.attr(null),
      variationDetails: this.attr(null),
      globalShippingProgram: this.attr(null),
      globalShippingReferenceID: this.attr(null),
      clickAndCollect: this.attr(null),
      clickAndCollectReferenceNumber: this.attr(null),
      itemNumber: this.string('')
    }
  }

  static get keyMap() {
    return new Map([
      ['Order Number', 'orderId'],
      ['Buyer Name', 'buyerName'],
      ['Buyer Email', 'buyerEmail'],
      ['Buyer Note', 'buyerNote'],
      ['Ship To Name', 'recipientName'],
      ['Ship To Phone', 'buyerPhoneNumber'],
      ['Ship To Address 1', 'shipAddress1'],
      ['Ship To Address 2', 'shipAddress2'],
      ['Ship To City', 'shipCity'],
      ['Ship To State', 'shipState'],
      ['Ship To Zip', 'shipPostalCode'],
      ['Ship To Country', 'shipCountry'],
      ['Item Number', 'itemNumber'],
      ['Item Title', 'productName'],
      ['Custom Label', 'sku'],
      ['Sale Date', 'purchaseDate'],
      ['Paid On Date', 'paymentsDate'],
      ['Ship By Date', 'promiseDate'],
      ['eBay Plus', 'eBayPlus'],
      ['Quantity', 'quantityPurchased'],
      ['Shipping Service', 'shipServiceLevel'],

      ['Sales Record Number', 'salesRecordNumber'],
      ['Buyer Username', 'buyerUsername'],
      ['Buyer Address 1', 'BuyerAddress1'],
      ['Buyer Address 2', 'BuyerAddress2'],
      ['Buyer City', 'buyerCity'],
      ['Buyer State', 'buyerState'],
      ['Buyer Zip', 'buyerZip'],
      ['Buyer Country', 'buyerCountry'],
      ['Sold Via Promoted Listings', 'soldViaPromotedListings'],
      ['Sold For', 'soldFor'],
      ['Shipping And Handling', 'shippingAndHandling'],
      ['Seller Collected Tax', 'sellerCollectedTax'],
      ['eBay Collected Tax', 'eBayCollectTax'],
      ['Electronic Waste Recycling Fee', 'electronicWasteRecyclingFee'],
      ['Mattress Recycling Fee', 'mattressRecyclingFee'],
      ['Additional Fee', 'additionalFee'],
      ['Total Price', 'totalPrice'],
      ['eBay Collected Tax and Fees Included in Total', 'eBayCollectedTaxAndFeesIncludedInTotal'],
      ['Payment Method', 'paymentMethod'],
      ['Minimum Estimated Delivery Date', 'MinimumEstimatedDeliveryDate'],
      ['Maximum Estimated Delivery Date', 'MaximumEstimatedDeliveryDate'],
      ['Shipped On Date', 'shipDate'],
      ['Feedback Left', 'feedbackLeft'],
      ['Feedback Received', 'feedbackReceived'],
      ['My Item Note', 'myItemNote'],
      ['PayPal Transaction ID', 'payPalTransactionID'],
      ['Tracking Number', 'trackingNum'],
      ['Transaction ID', 'transactionID'],
      ['Variation Details', 'variationDetails'],
      ['Global Shipping Program', 'globalShippingProgram'],
      ['Global Shipping Reference ID', 'globalShippingReferenceID'],
      ['Click And Collect', 'clickAndCollect'],
      ['Click And Collect Reference Number', 'clickAndCollectReferenceNumber']
    ])
  }

  static validate(data) {
    return Object.keys(data).includes('eBay Plus')
  }

  static get itemFields() {
    return [...super.itemFields, 'itemNumber']
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
    checkOrderCache(res)
    return new this(res, tenantKey)
  }

  static checkNoOrders() {
    if (errorCaches.size) {
      throw new HttpsError('cancelled', [...errorCaches].map(errorKey => errorMap[errorKey]).join(', '))
    }
  }

  constructor(data, tenantKey) {
    super(data, tenantKey)
    this.orderItemId = this.sku
    if (!this.sku) {
      errorCaches.add('error:customLabel')
    }
  }
}

function checkOrderCache(formData) {
  const {orderId} = formData
  if (!orderId) return
  const cacheOrder = orderIdCache[orderId]
  if (cacheOrder) {
    EbayOrder.keyMap.forEach((field) => {
      const val = formData[field] || cacheOrder[field] 
      if (val !== undefined) {
        formData[field] = val
      }
    })
    return
  }
  orderIdCache[orderId] = formData
}
