import env from '../config/env'
import Stripe from 'stripe'
import { addNumbers, toMoney } from '../utils/tools'

function createCharge (stripe, token, amount, fee, user) {
	logger.log('create charge')
	if (env.envType === 'development') {
		logger.log('running in development environment. Payment skip. Return success!')
		return Promise.resolve('success')
	}
	return stripe.charges.create({
		amount: Math.round((amount + fee) * 100), // amount in cent
		currency: 'usd',
		source: token.id,
		receipt_email: user.email,
	})
}

function calculateBonus (promotionDocs, amount, tenantKey) {
	let bonuses = { total: 0, details: [], appliedDocs: [] }
	try {
		Array.isArray(promotionDocs) && promotionDocs.forEach(doc => {
			if (!doc.exists) return
			let { tierDeposits = [], isAllowMultiple = false, appliedClients = [], startDate } = doc.data()
			if (startDate && startDate.toDate() > new Date()) return
			if (tierDeposits.length > 0 && !(!isAllowMultiple && appliedClients.includes(tenantKey))) {
				let sortedTierDeposits = [...tierDeposits].sort((a, b) => a.threshold > b.threshold)
				let promotionLevel
				sortedTierDeposits.forEach(level => { if (amount >= level.threshold) promotionLevel = level })
				if (promotionLevel) {
					logger.log('apply promotion: ', doc.id, promotionLevel)
					bonuses.details.push({ promotionKey: doc.id, threshold: promotionLevel.threshold, bonus: promotionLevel.bonus })
					bonuses.appliedDocs.push(doc)
					bonuses.total = addNumbers(bonuses.total, promotionLevel.bonus)
				}
			}
		})
	} catch (error) {
		logger.error(error)
		return { total: 0, details: [], appliedDocs: [] }
	}

	return bonuses
}

async function updateBalance (dbAccessor, tenantKey, warehouseKey, amount, fee, result, token, user) {
	logger.log('update balance: ', tenantKey, warehouseKey, amount)
	const docKey = warehouseKey + '_' + tenantKey
	let billingDocRef = dbAccessor.buildStoreQuery(['warehouses', warehouseKey, 'billings', docKey])
	let today = new Date()
	let predicates = [
		{
			field: 'endDate',
			compare: '>',
			value: today
		}
	]
	let promotions = await dbAccessor.queryWithPredicates(predicates, 'warehouses', warehouseKey, 'promotions')

	return dbAccessor.updateInTransaction(transaction => {
		let getPromises = [transaction.get(billingDocRef)]
		if (promotions.size > 0) {
			promotions.forEach(promotion => {
				getPromises.push(transaction.get(promotion.ref))
			})
		}
		return Promise.all(getPromises)
			.then(docs => {
				let [billingDoc, ...promotionDocs] = docs
				let bonuses = calculateBonus(promotionDocs, amount, tenantKey)
				let newBalance
				if (billingDoc.exists) {
					let billing = billingDoc.data()
					newBalance = addNumbers(billing.balance, amount, bonuses.total)
					transaction.update(billingDoc.ref, dbAccessor.addUpdateDocTimestamp({ balance: newBalance }))
				} else {
					newBalance = addNumbers(amount, bonuses.total)
					transaction.set(billingDocRef, dbAccessor.addNewDocTimestamp({ balance: newBalance, tenantKey }))
				}
				let card = env.envType === 'development' ? token.card : result.payment_method_details.card
				let receipt_email = env.envType === 'development' ? user.email : result.receipt_email
				let warehouseHistoryEntry = {
					amount,
					fee,
					bonuses: { total: bonuses.total, details: bonuses.details },
					transactionType: 'deposit',
					tenantKey,
					warehouseKey,
					cardType: card.brand || '',
					last4: card.last4 || '',
					clientIp: token.client_ip || '',
					receiptEmail: receipt_email,
					newBalance
				}
				if (bonuses.appliedDocs.length > 0) {
					bonuses.appliedDocs.forEach(appliedDoc => {
						let { appliedClients } = appliedDoc.data()
						if (Array.isArray(appliedClients)) {
							transaction.update(appliedDoc.ref, dbAccessor.addUpdateDocTimestamp(dbAccessor.getArrayFieldAddItem('appliedClients', tenantKey)))
						} else {
							transaction.update(appliedDoc.ref, dbAccessor.addUpdateDocTimestamp({ appliedClients: [tenantKey] }))
						}
					})
				}
				let warehouseHistoryEntryRef = dbAccessor.buildStoreQuery(['warehouseTransactions']).doc()
				transaction.set(warehouseHistoryEntryRef, dbAccessor.addNewDocTimestamp(warehouseHistoryEntry))
				return 'done'
			})
	})
}

async function updateSystemBalance (dbAccessor, clientKey,  amount, fee, result, token, user) {
	const balanceRef = dbAccessor.buildStoreQuery(['systemBalance', clientKey])
	const logRef = dbAccessor.buildStoreQuery(['systemTransactions']).doc()
	const card = env.envType === 'development' ? token.card : result.payment_method_details.card
	const clientDoc = await dbAccessor.query('warehouses', clientKey)
	if (!clientDoc.exists) throw Error('Missing client doc.')
	const {name: clientName} = clientDoc.data()

	await dbAccessor.updateInTransaction(async transaction => {
		const [balanceDoc, ...promotionDocs] = await Promise.all([transaction.get(balanceRef)])
		if (balanceDoc.exists) {
			let { balance = 0 } = balanceDoc.data()
			transaction.update(balanceDoc.ref, dbAccessor.addUpdateDocTimestamp({
				balance: addNumbers(balance, amount)
			}))
			let receipt_email = env.envType === 'development' ? user.email : result.receipt_email
			let bonuses = calculateBonus(promotionDocs, amount, clientKey)

			transaction.set(logRef, dbAccessor.addNewDocTimestamp({
				amount,
				fee,
				bonuses: { total: bonuses.total, details: bonuses.details },
				type: 'deposit',
				keywords: ['deposit'],
				clientKey,
				newBalance: addNumbers(balance, amount),
				clientName,
				cardType: card.brand || '',
				clientIp: token.client_ip || '',
				receiptEmail: receipt_email,
				last4: card.last4 || ''
			}))
		} else {
			const balance = toMoney(amount)
			transaction.set(balanceDoc.ref, dbAccessor.addNewDocTimestamp({
				balance,
				clientName
			}))

			transaction.set(logRef, dbAccessor.addNewDocTimestamp({
				amount,
				type: 'deposit',
				keywords: ['deposit'],
				clientKey,
				newBalance: balance,
				clientName,
				cardType: card.brand || '',
				last4: card.last4 || ''
			}))
		}
	})
}

export default async function makePayment (data, context) {
	let dbAccessor = context.appContext.dbAccessor
	const { uid, token = {} } = context.auth
	let { tenantKey, warehouseKey, paymentType, amount, stripeToken = {}, user = {}, isLiveChargeEnabled = false } = data
	let authDoc

	if (tenantKey && warehouseKey) {
		authDoc = await dbAccessor.query('auth', warehouseKey)
	} else {
		authDoc = await dbAccessor.query('auth', 'labelSupplier')
	}
	if (!authDoc.exists) throw Error('missing-stripe-auth-key')

	const { stripeLiveKey, stripeTestKey } = authDoc.data()
	let secretKey = isLiveChargeEnabled ? stripeLiveKey : stripeTestKey

	// validation
	if (!(stripeToken && stripeToken.id)) throw Error('missing-token')
	if (!amount || amount < 0) throw Error('invalid-amount')
	if (!paymentType) throw Error('missing-paymentType')
	// if (!tenantKey || !warehouseKey) throw Error('missing-tenant-warehouse-key')

	let fee = toMoney(amount * env.transactionFeeRate)
	let stripe = Stripe(secretKey)
	// todo: should we query users or tenants for relation
	return createCharge(stripe, stripeToken, amount, fee, user)
		.catch(error => {
			logger.error('make payment issue: ', error)
			error.status = 'rethrow'
			return Promise.reject(error)
		})
		.then(result => {
			if (result.error) {
				logger.log('payment failed', result)
				let error = result.error
				error.status = 'rethrow'
				return Promise.reject(error)
			} else {
				logger.log('payment success', result)
				if (tenantKey && warehouseKey) {
					return updateBalance(dbAccessor, tenantKey, warehouseKey, amount, fee, result, stripeToken, user)
				}
				return updateSystemBalance(dbAccessor, (tenantKey || warehouseKey), amount, fee, result, stripeToken, user)
			}

		})
		.catch(error => {
			if (error.status !== 'rethrow') {
				logger.error('*** update inventory error: ', error.message)
				return // don't re-throw here because charge is already done. Let user proceed
			}

			return Promise.reject(error)
		})
}
