"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const got = require("got");
const Storage = require("@google-cloud/storage");
const request = require("request");
const uuid = require("uuid/v1");
const location = require("./locations");
const notifications = require("./notifications");
const GeoFire = require("geofire");
const kUsername = "username";
const kProfilePictureUrl = "profile_picture_url";
const kUserId = "user_id";
const kDocumentId = "document_id";
admin.initializeApp(functions.config().firebase);
const db = admin.firestore();
const gcs = new Storage.Storage();
exports.checkIfDocumentExists = functions.https.onCall((data, context) => {
    const collection = data.collection;
    const keys = data.keys;
    const values = data.values;
    console.log("Querying on values key - " + keys + " value " + values + " - collection " + collection);
    const collectionReference = db.collection(collection);
    let counter = 0;
    let query = collectionReference.where(keys[counter], '==', values[counter]);
    keys.forEach(function (key) {
        if (counter > 0) {
            query = query.where(key, '==', values[counter]);
        }
        counter = counter + 1;
    });
    return query.get()
        .then(snapshot => {
        console.log("Initial query finished with " + snapshot.docs.length + ' results');
        if (snapshot.docs.length > 0) {
            return { doesExists: true };
        }
        else {
            return {};
        }
    }).catch(err => {
        return err;
    });
});
/**
 * Gets an array of User Documents
 *
 * @param {any} documents - An array of document query snapshots containing the user information
 * @param {any} userDocs - The User document snapshots
 * @returns an array of objects of type JSON objects with the user id and the user data included
 */
exports.getDocumentsToReturn = function (documents, userDocs) {
    const documentsToReturn = []; // This will hold the tags that will be returned with the userIds    
    const users = {}; // key: User Id value: User document
    console.log("The User Documents: " + userDocs.length);
    userDocs.forEach(function (user) {
        const userDoc = user.data();
        userDoc[kDocumentId] = user.id;
        users[user.id] = userDoc;
    });
    console.log(users);
    documents.forEach(document => {
        const documentCopy = document.data();
        console.log("The user_id being retrieved: " + document.get(kUserId));
        documentCopy[kUsername] = users[document.get(kUserId)][kUsername];
        documentCopy[kProfilePictureUrl] = users[document.get(kUserId)][kProfilePictureUrl];
        documentCopy[kDocumentId] = document.id;
        documentsToReturn.push({
            document: documentCopy,
            user: users[document.get(kUserId)]
        });
    });
    console.log("Retrieved user documents: " + documentsToReturn);
    return documentsToReturn;
};
/*
   Gets documents with the corresponding user information included within the document

   Required params:
      collection - String name of collection to search
      key - String key of document to get
      value - String value of document to get
*/
exports.getDocumentsWithUser = functions.https.onCall((data, context) => {
    const collection = data.collection;
    const key = data.key;
    const value = data.value;
    console.log('Executed tag query with key - ' + key + ', value - ' + value + ', collection - ' + collection);
    return db.collection(collection).where(key, '==', value).get()
        .then(snapshot => {
        console.log('Initial Query Executed With ' + snapshot.docs.length + ' results');
        if (snapshot.docs.length === 0) {
            return {}; // Returns a promise which contains nothing
        }
        const promises = getPromises(snapshot.docs);
        return { promises: promises, documents: snapshot.docs };
    }).catch(err => {
        return err;
    }).then(result => {
        if (result.promises !== undefined) {
            return Promise.all(result.promises)
                .then(userDocs => {
                const documentsToReturn = exports.getDocumentsToReturn(result.documents, userDocs);
                return documentsToReturn;
            }).catch(err => {
                return err;
            });
        }
        else {
            return {};
        }
    });
});
/**
 *
 *
 * @param {Array} docs - takes an array of query documents.  Each query document needs to contain a user_id key.
 * The value for the user_id key is used to generate a promise for retrieving the user from the "users" Firestore collection
 * @returns {Promise<FirebaseFirestore.DocumentSnapshot>[]} A promise which resolves with a Firebase document snapshot from the "users" Firestore collection
 */
function getPromises(docs) {
    const promises = [];
    const userIds = [];
    try {
        docs.forEach(function (doc) {
            // If this is not a duplicate  id    
            console.log("Creating promise if necessary for snapshot document");
            if (userIds.length === 0 || userIds.indexOf(doc.get(kUserId)) === -1) {
                // Get the user who owns this tag      
                const userRef = db.collection("users").doc(doc.get(kUserId));
                console.log("Created userRef object");
                const getUserDoc = userRef.get();
                console.log("Created promise successfully");
                promises.push(getUserDoc);
                console.log("Promise pushed to array");
                userIds.push(doc.get(kUserId));
                console.log("userId pushed to array");
            }
        });
        console.log("Created " + userIds.length + " promises");
    }
    catch (err) {
        console.log(err);
        return err;
    }
    return promises;
}
exports.getInstagramMedia = functions.https.onCall((data, context) => {
    return asyncGetInstagramMedia(data);
});
function asyncGetInstagramMedia(data) {
    return __awaiter(this, void 0, void 0, function* () {
        const access_token = data.query.access_token;
        const userId = data.query.user_id;
        // const auth = context.auth.uid        
        const batch = db.batch();
        console.log("received access_token: " + access_token);
        let instagramMedia;
        try {
            if (!access_token) {
                throw new Error("You must provide an access token with this request and send it with key 'access_token'.  To retrieve an access token, first handle the authentication process through Instagram.  For details on how to do this visit https://www.instagram.com/developer/authentication/");
            }
            console.log("https://api.instagram.com/v1/users/self/media/recent/?access_token=" + access_token);
            // Get all Instagram Media
            instagramMedia = yield got("https://api.instagram.com/v1/users/self/media/recent/?access_token=" + access_token + "&count=20", { json: true });
            console.log("instagram media request successful");
        }
        catch (error) {
            return error;
        }
        let addedPostCount = 0;
        for (let counter = 0; counter < instagramMedia.body.data.length; counter++) {
            const post = instagramMedia.body.data[counter];
            // Only store post with a location
            console.log("Post location " + post.location);
            if (post.location) {
                addedPostCount = addedPostCount + 1;
                const thumbnailUUID = uuid();
                const storage = admin.storage();
                const bucket = storage.bucket('asia-graffiti');
                const file = bucket.file(userId + "/images/" + thumbnailUUID + ".jpg");
                const thumbnailURL = yield saveImage(post.images.thumbnail.url, bucket.name, file, userId);
                const tag = getTagFromPost(post, userId, thumbnailURL);
                const tagRef = db.collection("tags").doc(tag.id);
                const tagBatch = db.batch();
                post.tags.forEach(function (myTag) {
                    const tagsRef = db.collection("tags").doc(myTag);
                    tagBatch.set(tagsRef, { "name": myTag });
                });
                yield tagBatch.commit();
                batch.set(tagRef, tag);
            }
        }
        return batch.commit().then(function () {
            return { success: "Imported " + addedPostCount + " posts from Instagram" };
        });
    });
}
function getTagFromPost(post, userId, thumbnailURL) {
    const tag = {
        user_id: undefined,
        id: undefined,
        picture_url: undefined,
        description: undefined,
        like_count: undefined,
        tags: {},
        location: undefined,
        address: undefined,
        is_instagram: undefined
    };
    tag.user_id = userId;
    tag.id = post.id;
    tag.picture_url = thumbnailURL;
    tag.description = post.caption.text;
    tag.like_count = post.likes.count;
    tag.tags = {};
    post.tags.forEach(function (myTag) {
        tag.tags[myTag] = true;
    });
    tag.location = post.location;
    tag.address = post.location.name;
    tag.is_instagram = true;
    console.log(tag);
    return tag;
}
function saveImage(url, bucketName, file, userId) {
    return __awaiter(this, void 0, void 0, function* () {
        const tokenUUID = uuid();
        const writeToServer = new Promise(function (resolve, reject) {
            request(url).pipe(file.createWriteStream({
                uploadType: "media",
                metadata: {
                    contentType: "image/jpg",
                    metadata: {
                        firebaseStorageDownloadToken: uuid()
                    }
                }
            }))
                .on('error', reject)
                .on('finish', resolve);
        });
        yield writeToServer;
        const publicUrl = ("https://firebasestorage.googleapis.com/v0/b/" + bucketName + "/o/" + encodeURIComponent(file.name) + "?alt=media&token=" + tokenUUID);
        console.log(publicUrl);
        return publicUrl;
    });
}
exports.handleIncrementDoc = function (collection, snapshot, incrementBy) {
    return __awaiter(this, void 0, void 0, function* () {
        const data = snapshot.data();
        const keys = [];
        const users = [];
        if (collection === "relationships") {
            keys.push("following_count");
            keys.push("follower_count");
            users.push(data.follower);
            users.push(data.followee);
        }
        else if (collection === "tags") {
            keys.push("piece_count");
            users.push(data.user_id);
        }
        try {
            const results = [];
            for (let counter = 0; counter < keys.length; counter++) {
                const result = yield incrementUserCount(users[counter], keys[counter], incrementBy);
                results.push();
            }
            console.log(results);
            return results;
        }
        catch (err) {
            console.log('Error in handleDoc function ' + err);
            return err;
        }
    });
};
exports.activityCreated = functions.firestore.document('activities/{activitiesId}')
    .onCreate((snapshot, context) => {
    const activity = snapshot.data();
    return notifications.sendNotification(activity.user_id, activity.message, admin);
});
exports.deleteRelationship = functions.firestore.document('relationships/{relationshipId}')
    .onDelete((snapshot, context) => {
    return exports.handleIncrementDoc("relationships", snapshot, -1);
});
exports.addLocationToTagsWithNoLocation = functions.pubsub.schedule('every day').onRun((context) => __awaiter(this, void 0, void 0, function* () {
    const querySnapshot = yield db.collection("tags").get();
    const tagLocationReference = admin.database().ref('piece_locations');
    const geoFire = new GeoFire(tagLocationReference);
    var locationDoc = {};
    for (let index = 0; index < querySnapshot.docs.length; index++) {
        const doc = querySnapshot.docs[index];
        const tagData = doc.data();
        const tagLocation = yield geoFire.get(doc.id);
        if (tagLocation == null) {
            const tagId = doc.id;
            const myLocation = [tagData.location.latitude, tagData.location.longitude];
            locationDoc[tagId] = myLocation;
        }
    }
    yield geoFire.set(locationDoc);
    console.log("Finished creating GeoFire documents for tags with no GeoFire document");
}));
function createGeoFireDocumentForTag(tag) {
    return __awaiter(this, void 0, void 0, function* () {
        const tagLocationReference = admin.database().ref('piece_locations');
        const tagData = tag.data();
        const geoFire = new GeoFire(tagLocationReference);
        geoFire.get(tag.id).then((tagLocation) => __awaiter(this, void 0, void 0, function* () {
            if (tagLocation == null) {
                const myLocation = [tagData.location.latitude, tagData.location.longitude];
                console.log("The location for the GeoFire document is " + myLocation);
                var tagId = tag.Id;
                yield geoFire.set({ tagId: myLocation });
                var returnMessage = "A GeoFire document with Id " + tag.Id + " was created successfully.";
                console.log(returnMessage);
                return returnMessage;
            }
            else {
                return "The tag with Id " + tag.id + " already has it's location saved.";
            }
        }), (error) => {
            console.error("Error updating getting tag: ", error);
            return error;
        });
    });
}
/*
Requires a document that consists of the following key values at least, user_id:String, location: { latitude:Double longitude:Double}
*/
exports.tagCreated = functions.firestore.document('tags/{tagId}')
    .onCreate((snapshot, context) => {
    return location.tagWithGeoFire(snapshot, admin);
});
exports.tagDeleted = functions.firestore.document('tags/{tagId}')
    .onDelete((snapshot, context) => {
    return location.deleteLocation(snapshot, admin);
});
exports.createRelationship = functions.firestore.document('relationships/{relationshipId}')
    .onCreate((snapshot, context) => {
    return exports.handleIncrementDoc("relationships", snapshot, 1);
});
function incrementUserCount(userId, key, byCount) {
    return __awaiter(this, void 0, void 0, function* () {
        // Get the user with {userId}
        const userRef = db.collection("users").doc(userId);
        console.log("Created userRef object");
        const userDoc = yield userRef.get();
        console.log("Received user document from server");
        let count = userDoc.data()[key];
        console.log("Received count from userDoc: " + count);
        if (!count) {
            count = 0;
        }
        const countDoc = {};
        countDoc[key] = count + byCount;
        try {
            yield userDoc.ref.set(countDoc, { merge: true });
            console.log("User document count updated");
            return key + " count for " + userDoc.data()["user_id"] + " incremented to " + (count + byCount);
        }
        catch (err) {
            console.log("Error in incrementUserCount function - " + err);
            return err;
        }
    });
}
/**
 * Deletes a document in a Firebase Firestore collection.  Requires that the {collection} as a string, {keys} as an array, and {values} as an array be sent in the HTTPS Request
 */
exports.deleteDocuments = functions.https.onCall((data, context) => {
    // Get the document to delete by it's key value pair
    const collection = data.collection;
    const keys = data.keys;
    const values = data.values;
    const query = getQuery(keys, values, collection);
    return query.get().then(snapshot => {
        if (snapshot.docs.length === 0) {
            return {};
        }
        const docId = snapshot.docs[0].id;
        return db.collection(collection).doc(docId).delete()
            .then(() => {
            return "Successfully deleted document with id " + docId;
        }).catch(error => {
            return error;
        });
    }).catch(error => {
        return error;
    });
});
/**
 * Creates a multi level Firebase query that can be executed with .get()
 * @param keys - The keys to query on
 * @param values - The values to query on
 * @param collection - The collection to query on
 * @returns FirebaseFirestore.Query
 */
function getQuery(keys, values, collection) {
    const collectionReference = db.collection(collection);
    let counter = 0;
    let query = collectionReference.where(keys[counter], '==', values[counter]);
    keys.forEach(function (key) {
        if (counter > 0) {
            query = query.where(key, '==', values[counter]);
        }
        counter = counter + 1;
    });
    return query;
}
exports.getDocumentsNearLocationHTTPS = functions.https.onRequest((req, res) => {
    return location.getDocumentsNearby(req.query, admin, res)
        .then(result => {
        console.log("Returning result: " + result);
        return res.send(result);
    })
        .catch(err => {
        return res.send(err);
    });
});
exports.getDocumentsNearLocation = functions.https.onCall((data, context) => {
    return location.getDocumentsNearby(data, admin, undefined)
        .then(result => {
        console.log("Returning result: " + result);
        return result;
    })
        .catch(error => {
        return error;
    });
});
//# sourceMappingURL=index.js.map