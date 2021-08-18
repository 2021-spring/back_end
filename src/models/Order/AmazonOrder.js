import Order from "./Order"
import {dashToCamelStyle} from '../../utils/tools'

const AMAZON_ORDER_ITEM_ID_LENGTH = 14

export default class AmazonOrder extends Order {
  static fields () {
    return {
      orderItemId: this.string('', v => String(v).padStart(AMAZON_ORDER_ITEM_ID_LENGTH, '0')),
      platform: this.string('Amazon'),
      isPrime: this.boolean(false)
    }
  }

  static validate(data) {
    return Object.keys(data).filter(key => ['order-id', 'order-item-id'].includes(key)).length === 2
  }

  static sourceMapping (rawData) {
    let res = {}
    Object.keys(rawData).forEach(key => {
      let formedKey = dashToCamelStyle(key)
      if (formedKey) {
        res[formedKey] = rawData[key]
      }
    })
    return new this(res)
  }

}