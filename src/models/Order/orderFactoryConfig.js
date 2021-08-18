import AmazonOrder from './AmazonOrder'
import EbayOrder from './EbayOrder'
import WalmartOrder from './WalmartOrder'
import NeweggOrder1 from './NeweggOrder1'
import NeweggOrder2 from './NeweggOrder2'
import CustomizeOrder from './CustomizeOrder'

/**
 * @typedef { 'amazon' | 'ebay' | 'walmart' | 'newegg' | 'customize'} Platform
 * 
 */
export const PLATFORMS = ['amazon', 'ebay']
export const PLATFORM_TO_MODEL = {
  'amazon': AmazonOrder,
  'ebay': EbayOrder,
  'walmart': WalmartOrder,
  'newegg1': NeweggOrder1,
  'newegg2': NeweggOrder2,
  'customize': CustomizeOrder
}

export const HEADER_ROW_MAXIMUM = 3

export const PLATFORM_TO_NAME = {
  'amazon': 'Amazon',
  'ebay': 'eBay',
  'walmart': 'Walmart',
  'newegg1': 'Newegg',
  'newegg2': 'Newegg',
  'customize': 'Customize'
}