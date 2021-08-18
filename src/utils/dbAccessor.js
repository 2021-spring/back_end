import {addNumbers} from '../utils/tools'

/**
 * @typedef {import('firebase-admin').firestore.QuerySnapshot} QuerySnapshot
 * @typedef {import('firebase-admin').firestore.DocumentSnapshot} DocumentSnapshot
 * @typedef {import('firebase-admin').firestore.Query} Query
 * @typedef {import('firebase-admin').firestore.Firestore} Firestore
 * @typedef {import('firebase-admin').firestore.FieldValue} FieldValue
 */


export class Accessor {
  /**
   * 
   * @param {Firestore} dbEngine 
   * @param {FieldValue} dbFieldValue 
   */
  initialize(dbEngine, dbFieldValue) {
    this.db = dbEngine
    this.dbFieldValue = dbFieldValue
  }

  deleteField () {
    return this.dbFieldValue.delete()
  }

  getServerTimestamp () {
    return this.dbFieldValue.serverTimestamp()
  }
  
  addUpdateDocTimestamp (obj) {
    obj.lastModifiedTime = this.getServerTimestamp()
    return obj
  }
  
  addNewDocTimestamp (obj) {
    obj.createTime = this.getServerTimestamp()
    obj.lastModifiedTime = this.getServerTimestamp()
    return obj
  }

  runAndLog (operation, opName = 'Operation') {
    return operation
      .catch(
        error => {
          logger.log(`${opName} failed`)
          logger.log(error)
          throw error
        }
      )
  }

  /**
   * 
   * @param {string[]} path 
   * @returns {FirebaseFirestore.CollectionReference<FirebaseFirestore.DocumentData> | FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>}
   */
  buildStoreQuery (path) {
    return path.reduce((previousValue, currentValue, currentIndex) => {
      return currentIndex % 2 === 0 ? previousValue.collection(currentValue) : previousValue.doc(currentValue)
    }, this.db)
  }

  buildStoreQueryPredicates (query, predicates, orderBy, isDescending, limit) {
    if (!predicates) { predicates = [] }
    query = predicates.reduce((previousValue, currentValue) => {
      return previousValue.where(currentValue.field, currentValue.compare, currentValue.value)
    }, query)
    orderBy && (query = (isDescending === true) ? query.orderBy(orderBy, 'desc') : query.orderBy(orderBy))
    limit && (query = query.limit(limit))
    return query
  }

  insert (payload, ...path) {
    let query = this.buildStoreQuery(path)
    return this.runAndLog(query.add(this.addNewDocTimestamp(payload)), 'insert store data')
  }

  set (payload, ...path) {
    let query = this.buildStoreQuery(path)
    return this.runAndLog(query.set(this.addNewDocTimestamp(payload)), 'set store data')
  }
  /**
   * 
   * @param {string[]} path 
   * @returns {Promise<QuerySnapshot | DocumentSnapshot>}
   */
  query (...path) {
    let query = this.buildStoreQuery(path)
    return this.runAndLog(query.get(), 'query firestore')
  }

  queryCollectionGroup (predicates, name) {
    let query = this.buildStoreQueryPredicates(this.db.collectionGroup(name), predicates)
    return this.runAndLog(query.get(), 'query firestore')
  }

  queryFirst (path, predicates) {
    let query = this.buildStoreQuery(path).limit(1)
    predicates && (query = this.buildStoreQueryPredicates(this.buildStoreQuery(path), predicates))
    return this.runAndLog(query.get(), 'query firestore')
  }

  queryWithPredicates (predicates, ...path) {
    let query = this.buildStoreQueryPredicates(this.buildStoreQuery(path), predicates)
    return this.runAndLog(query.get(), 'query firestore')
  }

  queryWithPredicatesAndOrder (predicates, path, orderBy, isDescending) {
    let query = this.buildStoreQueryPredicates(this.buildStoreQuery(path), predicates, orderBy, isDescending)
    return this.runAndLog(query.get(), 'query firestore')
  }

  update (payload, ...path) {
    let query = this.buildStoreQuery(path)
    return this.runAndLog(query.update(this.addUpdateDocTimestamp(payload)))
  }

  updateFields (payload, ...path) {
    let query = this.buildStoreQuery(path)
    return this.runAndLog(query.update(this.addUpdateDocTimestamp(payload)))
  }

  updateFieldAddToSetArray (fieldName, newItem, path) {
    let query = this.buildStoreQuery(path)
    let payload = {
      [fieldName]: this.dbFieldValue.arrayUnion(...newItem)
    }
    return this.runAndLog(query.update(this.addUpdateDocTimestamp(payload)))
  }

  fieldArrayUnion (items) {
    return this.dbFieldValue.arrayUnion(...items)
  }

  getArrayFieldAddItem (fieldName, item) {
    let payload = {
      [fieldName]: this.dbFieldValue.arrayUnion(item)
    }
    return payload
  }

  getArrayFieldRemoveItem (fieldName, item) {
    let payload = {
      [fieldName]: this.dbFieldValue.arrayRemove(item)
    }
    return payload
  }
  
  updateFieldRemoveFromSetArray (fieldName, removeItem, path) {
    let query = this.buildStoreQuery(path)
    let payload = {
      [fieldName]: this.dbFieldValue.arrayRemove(removeItem)
    }
    return this.runAndLog(query.update(this.addUpdateDocTimestamp(payload)))
  }

  remove (...path) {
    let query = this.buildStoreQuery(path)
    return this.runAndLog(query.delete())
  }

  getNewDocumentKey(...path) {
    return this.buildStoreQuery(path).doc()
  }

  // changes take the format: [{field, increment}]
  // if no predicates or predictes is empty array, then "path" should be for individual document
  // if predicates is not empty array, then it will apply changes to multiple documents
  // todo: consider refactor - seperate the single doc update and multiple docs update
  increaseValueInTransactionHelper (transaction, changes, path, predicates, deleteOnFieldsZero=[], createNewDocIfMissing = false, validationFunc = ((docData) => true)) {
    let hasPredicates = Array.isArray(predicates) && predicates.length > 0
    let query = hasPredicates ? this.buildStoreQueryPredicates(this.buildStoreQuery(path), predicates) : this.buildStoreQuery(path)
    return transaction.get(query).then((sfDoc) => {
      let newObj = {}
      if ((!hasPredicates && !sfDoc.exists) || (hasPredicates && sfDoc.size === 0)) {
        if (createNewDocIfMissing) {
          logger.log('Document does not exist, create one now')
          changes.forEach(change => {
            if (change.parentField) {
              let parentField = newObj[change.parentField] || {}
              parentField[change.field] = change.equal ? change.equal : change.increment
              newObj[change.parentField] = parentField
            } else {
              newObj[change.field] = change.equal ? change.equal : change.increment
            }
          })
          newObj.lastModifiedTime = new Date()
          let docRef = predicates ? this.buildStoreQuery(path).doc() : query
          transaction.set(docRef, newObj)
        } else {
          throw Error('validation-failed')
        }
      } else {
        let data = hasPredicates ? sfDoc.docs[0].data() : sfDoc.data()
        changes.forEach(change => {
          if (change.parentField) {
            let parentField = newObj[change.parentField] || data[change.parentField] || {}
            parentField[change.field] = parentField[change.field] || 0
            change.increment && (parentField[change.field] = addNumbers(parentField[change.field], change.increment))
            change.equal && (parentField[change.field] = change.equal)
            newObj[change.parentField] = parentField
          } else {
            let oldValue = data[change.field] || 0
            change.increment && (newObj[change.field] = addNumbers(oldValue, change.increment))
            change.equal && (newObj[change.field] = change.equal)
          }
        })
        newObj.lastModifiedTime = new Date()
        let docRef = hasPredicates ? this.buildStoreQuery(path).doc(sfDoc.docs[0].id) : query
        if (deleteOnFieldsZero.every(field => {return validationFunc(newObj[field])})) {
          if (deleteOnFieldsZero.length > 0 && deleteOnFieldsZero.some(field => newObj[field] === 0)) {
            transaction.delete(docRef)
          } else {
            transaction.update(docRef, this.addUpdateDocTimestamp(newObj))
          }
        } else {
          throw Error('validation-failed')
        }
      }
      return newObj
    })
  }

  increaseValueInTransaction (field, increment, ...path) {
    let query = this.buildStoreQuery(path)
    let transac = this.db.runTransaction(transaction => {
      return this.increaseValueInTransactionHelper(transaction, [{field, increment}], path)
    })
    return this.runAndLog(transac)
  }

  addArrayItemInTransaction (field, item, ...path) {
    let query = this.buildStoreQuery(path)
    let transac = this.db.runTransaction(transaction => {
      return transaction.get(query).then((sfDoc) => {
        if (!sfDoc.exists) {
          logger.log('Document does not exist')
          return null
        } else {
          let oldValue = sfDoc.data()[field] || []
          oldValue.push(item)
          let newObj = {}
          newObj[field] = oldValue
          return transaction.update(query, this.addUpdateDocTimestamp(newObj))
        }
      })
    })
    return this.runAndLog(transac)
  }

  /**
   * 
   * @param {(transaction: import('firebase-admin').firestore.Transaction) => any} func 
   */
  updateInTransaction (func) {
    let transac = this.db.runTransaction(transaction => {
      return func(transaction)
    })
    return this.runAndLog(transac) 
  }

  batch () {
    return this.db.batch()
  }

  removeAndInsertBatchStore (pathToRemove, item, pathToInsert) {
    let batch = this.db.batch()
    let removeQuery = this.buildStoreQuery(pathToRemove)
    let insertQuery = this.buildStoreQuery(pathToInsert).doc()
    batch.set(insertQuery, this.addNewDocTimestamp(item))
    batch.delete(removeQuery)
    return this.runAndLog(batch.commit())
  }
}

let dbAccessor = new Accessor()
export default dbAccessor
