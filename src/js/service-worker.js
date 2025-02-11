const firestore = {
    dbServer: "https://firestore.googleapis.com/v1/",
    projectPrefix: "projects/vocab-u-study/databases/(default)/documents",
    get baseUrl() {
        return this.dbServer + this.projectPrefix;
    },
    parseField: field => {
        if (field.integerValue) return parseInt(field.integerValue);
        if (field.doubleValue) return parseFloat(field.doubleValue);
        if (field.booleanValue) return field.booleanValue;
        if (field.stringValue) return field.stringValue;
        if (field.mapValue) return firestore.parseMap(field.mapValue);
        if (field.arrayValue?.values) return field.arrayValue.values.map(firestore.parseField);
        return null;
    },
    createField: value => {
        if (Number.isInteger(value)) return { integerValue: value.toString() };
        if (typeof value === "number") return { doubleValue: value.toString() };
        if (typeof value === "boolean") return { booleanValue: value };
        if (typeof value === "string") return { stringValue: value };
        if (value instanceof Array) return { arrayValue: { values: value.map(firestore.createField) } };
        if (value instanceof Object) return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, value]) => [key, firestore.createField(value)])) } };
        return null;
    },
    parseMap: map => {
        const result = {};
        for (const key in map.fields) result[key] = firestore.parseField(map.fields[key]);
        return result;
    },
    getDocument: async function (collection, documentId) {
        let res = await fetch(`${this.baseUrl}/${collection.collectionKey}/${documentId}`);
        let json = await res.json();
        return {
            id: documentId,
            ...firestore.parseMap(json),
            createTime: new Date(Date.parse(json.createTime)),
            updateTime: new Date(Date.parse(json.updateTime))
        };
    },
    getDocuments: async function (collection, structuredQuery) {
        structuredQuery.from = [{ collectionId: collection.collectionKey }];
        let res = await fetch(`${this.baseUrl}:runQuery`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ structuredQuery })
        });
        let json = await res.json();
        return json.map(({document: doc}) => ({
            id: doc.name.split("/").pop(),
            ...firestore.parseMap(doc),
            createTime: new Date(Date.parse(doc.createTime)),
            updateTime: new Date(Date.parse(doc.updateTime))
        }));
    },
    getDocumentsForIds: async function (collection, documentIds) {
        let res = await fetch(`${this.baseUrl}:batchGet`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ documents: documentIds.map(id => `${this.projectPrefix}/${collection.collectionKey}/${id}`) })
        });
        let json = await res.json();
        return json.filter(doc => doc.found).map(({found: doc}) => ({
            id: doc.name.split("/").pop(),
            ...firestore.parseMap(doc),
            createTime: new Date(Date.parse(doc.createTime)),
            updateTime: new Date(Date.parse(doc.updateTime))
        }));
    }
};

if (location.hostname === "localhost")
    firestore.dbServer = "http://localhost:8080/v1/";

class Document {
    constructor({id, createTime, updateTime}) {
        /** @type {String} */
        this.id = id;
        /** @type {Date} */
        this.createTime = createTime;
        /** @type {Date} */
        this.updateTime = updateTime;
    }
    static async get(id) {
        return new this(await firestore.getDocument(this, id));
    }
    static async getDocuments(structuredQuery) {
        return (await firestore.getDocuments(this, structuredQuery)).map(doc => new this(doc));
    }
    static async getDocumentsForIds(documentIds) {
        return (await firestore.getDocumentsForIds(this, documentIds)).map(doc => new this(doc));
    }
}

class MetaSet extends Document {
    static collectionKey = "meta_sets";
    constructor(data) {
        super(data)
        /** @type {String} */
        this.name = data.name;
        /** @type {String[]} */
        this.nameWords = data.nameWords;
        /** @type {String} */
        this.creator = data.creator;
        /** @type {String} */
        this.uid = data.uid;
        /** @type {Boolean} */
        this.public = data.public;
        /** @type {Number} */
        this.numTerms = data.numTerms;
        /** @type {String[]} */
        this.collections = data.collections;
        /** @type {Number} */
        this.likes = data.likes;
    }
}

class CustomCollection extends Document {
    static collectionKey = "collections";
    constructor(data) {
        super(data);
        /** @type {String} */
        this.name = data.name;
        /** @type {String[]} */
        this.sets = data.sets;
        /** @type {String} */
        this.uid = data.uid;
    }
}

class VocabSet extends Document {
    static collectionKey = "sets";
    constructor(data) {
        super(data)
        /** @type {String} */
        this.name = data.name;
        /** @type {String} */
        this.description = data.description;
        /** @type {String} */
        this.uid = data.uid;
        /** @type {Boolean} */
        this.public = data.public;
        /** @type {{term: String, definition: String}[]|{body: String?, type: Number, questions: {type: Number, question: String, answers: String[]}[]}[]} */
        this.terms = data.terms;
    }
}

class QueryBuilder {
    constructor() {
        this.query = {};
    }
    /**
     * @param {String} field 
     * @param {"LESS_THAN"|"LESS_THAN_OR_EQUAL"|"GREATER_THAN"|"GREATER_THAN_OR_EQUAL"|"EQUAL"|"NOT_EQUAL"|"ARRAY_CONTAINS"|"IN"|"ARRAY_CONTAINS_ANY"|"NOT_IN"} op 
     * @param {any} value 
     * @returns {this}
     */
    where(field, op, value) {
        let fieldFilter = { fieldFilter: { field: { fieldPath: field }, op, value: firestore.createField(value) } };
        if (!this.query.where) this.query.where = fieldFilter;
        else if (this.query.where.fieldFilter) this.query.where = { compositeFilter: { op: "AND", filters: [this.query.where, fieldFilter] } };
        else this.query.where.compositeFilter.filters.push(fieldFilter);
        return this;
    }
    /**
     * @param {string} field 
     * @param {"ASCENDING"|"DESCENDING"} direction 
     * @returns {this}
     */
    orderBy(field, direction) {
        if (!this.query.orderBy) this.query.orderBy = [];
        this.query.orderBy.push({ field: { fieldPath: field }, direction });
        return this;
    }
    /**
     * @param {Number} limit 
     * @returns {this}
     */
    limit(limit) {
        this.query.limit = limit;
        return this;
    }
    /**
     * @param {Number} limit 
     * @returns {this}
     */
    setOffset(offset) {
        this.query.offset = offset;
        return this;
    }
    build() {
        return this.query;
    }
}